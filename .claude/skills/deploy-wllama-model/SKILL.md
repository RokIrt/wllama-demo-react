---
name: deploy-wllama-model
description: Split a >2 GB GGUF model into wllama-compatible shards and deploy it to Hugging Face, then add it to the app catalog. Use when adding a model over 2 GB to the wllama demo, splitting a GGUF, or publishing split models to HF.
---

# Deploy a >2 GB GGUF model to Hugging Face for wllama

wllama cannot load a single file over **2 GB** (ArrayBuffer limit), and total
model size is bounded by its **4 GB 32-bit WASM heap** (~3.5 GB practical after
context/compute buffers — system RAM does not raise this). Models between 2 and
~3.5 GB must be split into shards under 2 GB each and hosted somewhere public.
This skill produces such a split on Hugging Face and wires it into the app.

## Step 0 — Feasibility gate (do this before downloading anything)

1. **Total size** — list quants with exact sizes:
   ```bash
   curl -sL "https://huggingface.co/api/models/<org>/<repo>?blobs=true" | node -e "
   let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
     JSON.parse(d).siblings.filter(s=>s.rfilename.endsWith('.gguf'))
       .sort((a,b)=>a.size-b.size)
       .forEach(s=>console.log((s.size/1e9).toFixed(2)+' GB  '+s.rfilename));});"
   ```
   Pick the best-quality quant with total size **≤ ~3.5 GB** (prefer Q4 > Q3 > Q2;
   K-quants over IQ-quants — wllama docs warn IQ quants can be slow, but IQ2 is
   acceptable when it's the only thing that fits). Skip `mmproj-*` and `mtp-*`
   files — only the main GGUF is needed for text chat.
   If nothing fits ≤ 3.5 GB, the model cannot run in wllama. Stop and say so.

2. **Architecture support** — the GGUF arch must be compiled into wllama's
   llama.cpp build:
   ```bash
   # arch name of the model
   curl -sL "https://huggingface.co/api/models/<org>/<repo>?expand[]=gguf" | node -pe "JSON.parse(require('fs').readFileSync(0)).gguf.architecture"
   # is it in the wasm? Use a substring grep, NOT exact match — loader strings
   # may appear as variants (e.g. gemma4 shows up as "Gemma 4 requires..." / gemma4a)
   strings node_modules/@wllama/wllama/esm/wasm/wllama.wasm | grep -i "<arch>" | head
   ```
   No hits at all → unsupported; stop.

## Step 1 — Download and split

```bash
mkdir -p /tmp/wllama-split && cd /tmp/wllama-split
curl -sL -o model.gguf "https://huggingface.co/<org>/<repo>/resolve/main/<file>.gguf"

# llama-gguf-split from any recent llama.cpp release (asset: llama-bNNNNN-bin-ubuntu-x64.tar.gz)
curl -sL -o llama.tar.gz "https://github.com/ggml-org/llama.cpp/releases/download/<tag>/llama-<tag>-bin-ubuntu-x64.tar.gz"
tar xzf llama.tar.gz

./llama-*/llama-gguf-split --split-max-size 1G model.gguf <model-name>
ls -la <model-name>-0000*.gguf   # shards are named -00001-of-0000N
```

Every shard must be **< 2 GB**. One shard may exceed the 1G target (a single
tensor, usually embeddings, can't be split) — that's fine as long as it's under
2 GB. Free disk needed: ~2× model size.

## Step 2 — Create the HF repo and upload

Token: `~/.cache/huggingface/token` (write-scoped, account **888rok**). Verify
first: `curl -s -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" https://huggingface.co/api/whoami-v2`

> ⚠️ **On this machine, Python networking hangs (DNS)** — `hf upload` /
> `huggingface_hub` stall silently (symptom: process alive, no TX bytes).
> Use the raw curl git-LFS flow below. On a normal machine,
> `hf upload <user>/<repo> <shard> <shard>` per file is equivalent and simpler.

1. **Create the public repo** (must be public so the app can fetch without auth):
   ```bash
   curl -s -X POST "https://huggingface.co/api/repos/create" \
     -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" \
     -H "Content-Type: application/json" \
     -d '{"name":"<model-name>-wllama-split","type":"model","private":false}'
   ```

2. **Hash the shards**: `sha256sum <model-name>-0000*.gguf`

3. **LFS batch** — request presigned upload URLs (one `objects` entry per shard):
   ```bash
   curl -s -X POST "https://huggingface.co/<user>/<repo>.git/info/lfs/objects/batch" \
     -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" \
     -H "Accept: application/vnd.git-lfs+json" -H "Content-Type: application/vnd.git-lfs+json" \
     -d '{"operation":"upload","transfers":["basic"],"hash_algo":"sha256",
          "objects":[{"oid":"<sha256>","size":<bytes>}, ...]}' > lfs-batch.json
   ```
   An object with no `actions` is already uploaded (dedup) — skip its PUT/verify.

4. **PUT each shard** to its `objects[i].actions.upload.href`, then POST its
   `actions.verify.href` (run in background; big uploads take minutes):
   ```bash
   curl -sS --fail -X PUT -T "<shard>" -H "Content-Type: application/octet-stream" "<upload.href>"
   curl -sS --fail -X POST "<verify.href>" \
     -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" \
     -H "Accept: application/vnd.git-lfs+json" -H "Content-Type: application/vnd.git-lfs+json" \
     -d '{"oid":"<sha256>","size":<bytes>}'
   ```

5. **Commit** — ties the LFS objects into the repo; include a README crediting
   the original model + quantizer and stating it's split for wllama:
   ```bash
   cat > commit.ndjson <<EOF
   {"key":"header","value":{"summary":"Add <model-name> split for wllama"}}
   {"key":"file","value":{"path":"README.md","content":"$(base64 -w0 README.md)","encoding":"base64"}}
   {"key":"lfsFile","value":{"path":"<shard1>","algo":"sha256","oid":"<sha256>","size":<bytes>}}
   ... one lfsFile line per shard ...
   EOF
   curl -s -X POST "https://huggingface.co/api/models/<user>/<repo>/commit/main" \
     -H "Authorization: Bearer $(cat ~/.cache/huggingface/token)" \
     -H "Content-Type: application/x-ndjson" --data-binary @commit.ndjson
   ```

6. **Verify** every shard resolves publicly **without** auth:
   ```bash
   curl -sIL "https://huggingface.co/<user>/<repo>/resolve/main/<shard>" -o /dev/null -w "%{http_code}\n"
   ```

## Step 3 — Add to the app catalog

In `src/config.ts`, append to `MODELS` — point `url` at the **first shard**
(wllama auto-resolves the rest from the `-00001-of-0000N` pattern):

```ts
{
  name: '<Display Name>',
  params: '<e.g. 4B>',
  quant: '<e.g. Q3_K_M>',
  size: <exact sum of all shard bytes>,
  url: 'https://huggingface.co/<user>/<repo>/resolve/main/<model-name>-00001-of-0000N.gguf',
  shards: <N>,
  note: '<RAM requirement, e.g. "needs ~6 GB free RAM">',
},
```

Then `npm run build` must pass.

## Step 4 — Verify (within this machine's limits)

This box has 6.5 GB RAM: **do not load models over ~1 GB in the browser here —
the tab OOM-crashes.** Verify by: shard URLs return 200, the model card renders
with "· N files", and (optionally) the download starts with aggregate progress.
Actual load + inference of large models must be confirmed by the user on a
machine with enough RAM (rule of thumb: ~2.5× total model size free).

## Step 5 — Clean up

`rm -rf /tmp/wllama-split` (frees ~2× model size). Tell the user the repo URL
and the RAM needed to run the model.
