#!/bin/bash
# DocHub - From Requirements to Architecture Design
# Starts DocHub with Claude on Microsoft Foundry.
# First run: asks for your Foundry details and saves them in .foundry.env (only you can read it).
cd "$(dirname "$0")" || exit 1
CONF=".foundry.env"

echo "DocHub - From Requirements to Architecture Design"

ask() {
  echo "First-time setup: Claude on Microsoft Foundry"
  echo "(Azure portal > your Foundry resource > Endpoints and keys)"
  echo
  read -r -p "Resource name (just the name, not a URL): " RES
  read -r -s -p "API key (typing is hidden): " KEY; echo
  read -r -p "Claude deployment name [claude-sonnet-4-5]: " MODEL
  MODEL=${MODEL:-claude-sonnet-4-5}
  {
    printf 'ANTHROPIC_FOUNDRY_RESOURCE=%q\n' "$RES"
    printf 'ANTHROPIC_FOUNDRY_API_KEY=%q\n' "$KEY"
    printf 'ANTHROPIC_DEFAULT_SONNET_MODEL=%q\n' "$MODEL"
  } > "$CONF"
  chmod 600 "$CONF"
}

[ -f "$CONF" ] || ask

load() {
  set -a; . "./$CONF"; set +a
  export CLAUDE_CODE_USE_FOUNDRY=1
  export ANTHROPIC_DEFAULT_OPUS_MODEL="$ANTHROPIC_DEFAULT_SONNET_MODEL"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="$ANTHROPIC_DEFAULT_SONNET_MODEL"
}
load

if ! command -v claude >/dev/null 2>&1; then
  echo; echo "The 'claude' command was not found. Install Claude Code first (https://code.claude.com), then run this again."
  read -r -p "Press Enter to close"; exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo; echo "python3 was not found. Install Python 3, then run this again."
  read -r -p "Press Enter to close"; exit 1
fi

if ! PYTHONPATH="$PWD/.pydeps" python3 -c "import markitdown" >/dev/null 2>&1; then
  echo; echo "MarkItDown (reads Word, PDF, PowerPoint and Excel files) is not installed."
  read -r -p "Install it now into the tool's own folder? About 1-2 minutes. [Y/n] " A
  if [ "$A" != "n" ] && [ "$A" != "N" ]; then
    python3 -m pip install --upgrade --target "$PWD/.pydeps" "markitdown[docx,pdf,pptx,xlsx,xls]" || echo "Installation failed. You can try again later with the Install MarkItDown button in the tool."
  fi
fi

echo; echo "Checking the connection to Claude on Foundry..."
OUT=$(claude -p "Reply with the single word OK" 2>&1)
if [ $? -ne 0 ]; then
  echo; echo "Claude did not answer:"; echo "$OUT"; echo
  echo "Most likely the resource name, key or deployment name is wrong."
  read -r -p "Enter the details again? [Y/n] " A
  if [ "$A" != "n" ] && [ "$A" != "N" ]; then rm -f "$CONF"; exec "$0"; fi
  exit 1
fi
echo "Claude answered. Starting the tool."

PORT=8765
if command -v open >/dev/null 2>&1; then (sleep 2; open "http://127.0.0.1:$PORT") & fi
echo "Leave this window open while you use the tool. Close it to stop."
exec python3 src/server.py --port "$PORT"
