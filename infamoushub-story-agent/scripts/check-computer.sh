#!/bin/sh
# Read-only local computer check: no installs, uploads, purchases or posts.
set -u
echo 'InfamousHub Story Agent: local computer check'
echo 'Read-only: no changes, purchases, uploads, or publications.'
voice=${1:-voices/en_US-lessac-medium.onnx}
missing=0
for tool in python3 ffmpeg ffprobe ollama piper; do
  if command -v "$tool" >/dev/null 2>&1; then echo "[OK]      $tool found";
  else echo "[MISSING] $tool not found"; missing=$((missing+1)); fi
done
if [ -s "$voice" ]; then echo '[OK]      Piper voice file present'
else echo '[MISSING] Piper .onnx voice absent'; missing=$((missing+1)); fi
if [ -s "${voice}.json" ]; then echo '[OK]      Piper metadata file present'
else echo '[MISSING] Piper .onnx.json voice metadata absent'; missing=$((missing+1)); fi
if command -v ollama >/dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -Eq '^llama3[.]1:8b[[:space:]]'; then
    echo '[OK]      Ollama llama3.1:8b model listed'
  else echo '[MISSING] Ollama llama3.1:8b not listed'; missing=$((missing+1)); fi
fi
if command -v free >/dev/null 2>&1; then
  free -h | awk 'NR==2 {printf "[INFO]    Physical RAM: %s\n",$2}'
elif command -v sysctl >/dev/null 2>&1; then
  bytes=$(sysctl -n hw.memsize 2>/dev/null || true)
  if [ -n "$bytes" ]; then awk -v b="$bytes" 'BEGIN {printf "[INFO]    Physical RAM: %.1f GiB\n",b/1073741824}'; fi
fi
df -h . 2>/dev/null | awk 'NR==2 {printf "[INFO]    Free disk: %s\n",$4}'
if [ "$missing" -eq 0 ]; then echo 'Presence checks passed. Still need an actual video test.'
else echo "Missing checks: $missing. Publishing must stay OFF."; fi
echo 'No account credentials or private files were collected.'
