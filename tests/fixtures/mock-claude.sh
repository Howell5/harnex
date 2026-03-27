#!/bin/bash
# Mock claude CLI for testing process manager
echo "Mock claude running with args: $@"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) echo "PROMPT: $2"; shift 2 ;;
    --max-turns) echo "MAX_TURNS: $2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "Mock claude completed"
exit 0
