"""
MigrationOS Autonomous Agent — Fixed Version
=============================================
SETUP:
    pip install google-antigravity
    $env:GEMINI_API_KEY="tumhari_key"   (PowerShell)

RUN:
    python run_agent.py
"""

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────
# CONFIG — apne path ke mutabiq set karo
# ─────────────────────────────────────────
PROJECT_PATH = r"D:\Usama Data\All Software\migration-os"
LOG_FILE     = "agent_log.txt"
MAX_RETRIES  = 3

# ─────────────────────────────────────────
# SYSTEM INSTRUCTIONS
# ─────────────────────────────────────────
SYSTEM_INSTRUCTIONS = """
You are an autonomous senior software engineer working on MigrationOS.
Your only job is to execute tasks from .ai/TASK-QUEUE.md one by one.

RULES:
- Start every session: read .ai/TASK-QUEUE.md then .ai/PROJECT-STATUS.md
- Pick first incomplete [ ] task
- Execute it fully: implement, validate, fix, document
- Mark [x] with proof when done
- Move to next [ ] task immediately
- Never ask "Should I continue?" — always continue
- Never say "Next steps are..." — execute them

STOP SIGNALS — end response with exactly one of:
  AGENT_CONTINUE: [task done] → [next task]
  AGENT_STOP: BLOCKED — [exact reason needing user action]
  AGENT_DONE: All approved tasks complete

ONLY stop for:
- Missing credentials or secrets
- Paid service approval needed
- Production deployment approval needed
- All tasks complete
"""

TASK_PROMPT = """
Read .ai/TASK-QUEUE.md now.
Find the first task marked [ ] — execute it completely.

Steps:
1. Implement
2. Validate (npm run lint, typecheck, test, build as needed)
3. Fix failures
4. Re-validate
5. Mark [x] in TASK-QUEUE.md with proof
6. Update .ai/PROJECT-STATUS.md

Then check: is there another unblocked [ ] task?
If yes  → start it. End with: AGENT_CONTINUE: [done] → [next]
If blocked → End with: AGENT_STOP: BLOCKED — [reason]
If all done → End with: AGENT_DONE: All approved tasks complete
"""

# ─────────────────────────────────────────
# LOGGER
# ─────────────────────────────────────────
def log(message: str):
    timestamp = datetime.now().strftime("%H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

# ─────────────────────────────────────────
# RESULT PARSER
# ─────────────────────────────────────────
def parse_result(text: str) -> tuple:
    for line in reversed(text.strip().split("\n")):
        line = line.strip()
        if line.startswith("AGENT_CONTINUE:"):
            return "continue", line.replace("AGENT_CONTINUE:", "").strip()
        if line.startswith("AGENT_STOP:"):
            return "stop", line.replace("AGENT_STOP:", "").strip()
        if line.startswith("AGENT_DONE:"):
            return "done", line.replace("AGENT_DONE:", "").strip()
    return "unknown", "No status signal in response"

# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
async def run():
    # Checks
    if not Path(PROJECT_PATH).exists():
        print(f"\nERROR: Project folder nahi mila:\n  {PROJECT_PATH}")
        print("run_agent.py mein PROJECT_PATH update karo.\n")
        sys.exit(1)

    if not os.environ.get("GEMINI_API_KEY"):
        print("\nERROR: GEMINI_API_KEY set nahi hai.")
        print("PowerShell mein: $env:GEMINI_API_KEY=\"tumhari_key\"\n")
        sys.exit(1)

    try:
        from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
        from google.antigravity.hooks.policy import allow, deny
    except ImportError:
        print("\nERROR: google-antigravity install nahi.")
        print("Run karo: pip install google-antigravity\n")
        sys.exit(1)

    # Policy — run_command allow, generate_image deny (unnecessary)
    policies = [
        allow("run_command"),
        allow("view_file"),
        allow("edit_file"),
        allow("create_file"),
        allow("list_directory"),
        allow("search_directory"),
        allow("find_file"),
        deny("generate_image"),
    ]

    config = LocalAgentConfig(
        system_instructions=SYSTEM_INSTRUCTIONS,
        capabilities=CapabilitiesConfig(),
        policies=policies,
        base_url="http://localhost:20128/v1",
        api_key="sk-9a6d41538dc7f413-9f5f34-85039c5b",  )


    os.chdir(PROJECT_PATH)

    log("=" * 55)
    log("MigrationOS Autonomous Agent — Starting")
    log(f"Project: {PROJECT_PATH}")
    log(f"Log: {LOG_FILE}")
    log("Rokna ho toh: Ctrl+C")
    log("=" * 55)

    iteration   = 0
    retry_count = 0

    async with Agent(config) as agent:
        while True:
            iteration += 1
            log(f"\n--- Iteration {iteration} ---")

            try:
                response = await agent.chat(TASK_PROMPT)
                result   = await response.text()

                preview = result[:250].replace("\n", " ")
                log(f"Response: {preview}...")

                status, message = parse_result(result)
                log(f"Status: [{status}] {message}")

                if status == "continue":
                    retry_count = 0
                    log(f"✓ Task complete — next task shuru")
                    await asyncio.sleep(2)

                elif status == "stop":
                    log(f"\n⚠  RUKA: {message}")
                    log("Blocker resolve karo phir dobara chalao.")
                    break

                elif status == "done":
                    log(f"\n✅ MUKAMMAL: {message}")
                    break

                else:
                    retry_count += 1
                    log(f"Signal nahi mila — retry {retry_count}/{MAX_RETRIES}")
                    if retry_count >= MAX_RETRIES:
                        log("Max retries. Manually check karo.")
                        break
                    await asyncio.sleep(3)

            except KeyboardInterrupt:
                log("\nCtrl+C — Band kar diya.")
                break
            except Exception as e:
                log(f"ERROR: {e}")
                retry_count += 1
                if retry_count >= MAX_RETRIES:
                    log("Zyada errors. Band kar raha hoon.")
                    break
                await asyncio.sleep(5)

    log("\n" + "=" * 55)
    log(f"Session complete. Log file: {LOG_FILE}")
    log("=" * 55)


if __name__ == "__main__":
    asyncio.run(run())