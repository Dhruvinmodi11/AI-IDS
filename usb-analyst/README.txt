Local Analyst (USB, no PC install)
==================================

Nothing is installed on the computer. No Python, no Ollama, no Visual Studio.
The PC only needs Windows 10/11 and a browser (already there).

All of this lives on the stick:
  F:\Start Analyst.bat
  F:\gemma\Start-Analyst.ps1
  F:\gemma\dashboard\          UI
  F:\gemma\bin\llama\          llama-server.exe + DLLs
  F:\gemma\models\             Gemma GGUF
  F:\gemma\state\chats.json    your chats
  F:\gemma\tmp\  F:\gemma\cache\

Windows blocks USB AutoRun. Double-click F:\Start Analyst.bat
Leave the window open. Close it to stop, then Eject.

Chat like a normal assistant. Attach CSV/JSON/TXT with + or drag onto the box.
KPIs for tables are computed in the browser; the model writes the reply.
