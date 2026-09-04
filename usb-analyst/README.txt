Local Analyst (USB agent, no PC install)
========================================

Nothing is installed on the computer. No Python, no Ollama, no Visual Studio.
The PC only needs Windows 10/11, a browser, and existing GPU drivers.

All of this lives on the stick:
  F:\Start Analyst.bat
  F:\gemma\Start-Analyst.ps1
  F:\gemma\dashboard\          ChatGPT-style UI + agent
  F:\gemma\bin\llama\          llama-server.exe + DLLs
  F:\gemma\models\             GGUF (Gemma 3n and/or Qwen2.5-7B)
  F:\gemma\data\               CSVs the agent can list/read/profile
  F:\gemma\reports\            files the agent writes
  F:\gemma\state\chats.json    your chats
  F:\gemma\tmp\  F:\gemma\cache\

Windows blocks USB AutoRun. Double-click F:\Start Analyst.bat
Leave the window open. Close it to stop, then Eject.

Chat like a normal assistant. The agent can:
  - list_files       USB data/ and reports/
  - profile_table    authoritative sums / means (use these numbers)
  - read_file        text/CSV/JSON in those folders
  - search_files     find a string in those folders
  - write_report     save .md/.txt into reports/

You can also attach a file with + or drag onto the box.

You do NOT need a model trained on Indian pharma data. The local model
plus CDSCO / Schedule M / GMP / PV prompting is enough. Numbers come
from the tools, not from the model's memory.

Optional better tool-following (RTX 4060 8 GB):
  powershell -NoProfile -ExecutionPolicy Bypass -File F:\gemma\Fetch-Qwen.ps1
That downloads Qwen2.5-7B-Instruct Q4_K_M (~4.68 GB) onto the stick.
The launcher prefers Qwen when both Qwen and Gemma are present.

Not a doctor. Not a CDSCO filing system. If a file looks like patient
data, ask the agent for aggregates only (DPDP).
