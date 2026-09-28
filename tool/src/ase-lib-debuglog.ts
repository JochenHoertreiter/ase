/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import fs   from "node:fs"
import path from "node:path"

import { userStateDir } from "./ase-config-scope.js"

/*  validate a session id against the accepted character set, mirroring
    HookCommand#isValidSessionId, before it is used as a path component  */
const isValidSessionId = (id: string): boolean =>
    /^[A-Za-z0-9._-]+$/.test(id)

/*  diagnostic log file, placed into the per-session state directory --
    deliberately independent of the regular per-project ASE logging (Log
    class, ".ase/service.log"), so it keeps working even while the regular
    logging path is being debugged  */
const logFile = (): string => {
    const sessionId = process.env.ASE_SESSION_ID ?? ""
    return path.join(userStateDir(), "session",
        isValidSessionId(sessionId) ? sessionId : "-", "ase.log")
}

/*  the ASE component emitting a log line  */
export type DebugSource = "HOOK" | "MCP" | "SERVICE"

/*  render a single log line in the fixed format
    "[<date+time>] [<process id>] [<agent tool>] [<source>] <message>"  */
const render = (tool: string, source: DebugSource, message: string): string => {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "")
    return `[${timestamp}] [${process.pid}] [${tool}] [${source}] ${message}\n`
}

/*  pending state of the once-per-process header line: the process identity
    is emitted in front of the very first log line only, so parent process
    and working directory are on record without bloating every line  */
let headerPending = true

/*  append a diagnostic log line; the agent tool is passed explicitly where
    it is known authoritatively (the hook handlers receive it as a CLI
    option) and is otherwise derived from the environment, where "-" marks
    an agent tool which did not propagate ASE_TOOL to the process  */
export const debugLog = (source: DebugSource, message: string, tool?: string): void => {
    try {
        const agentTool = tool ?? process.env.ASE_TOOL ?? "-"
        let text = ""
        if (headerPending) {
            headerPending = false
            text += render(agentTool, source, `process: ppid=${process.ppid}, cwd=${process.cwd()}`)
        }
        text += render(agentTool, source, message)
        const file = logFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, text)
    }
    catch (_e) {
        /*  best-effort: diagnostic logging must never break the caller  */
    }
}

/*  append a one-off dump of every environment variable which could carry the
    directory the agent tool was launched in: a process started by a shell
    inherits that shell's environment, so a propagated working directory would
    show up here without any need to inspect a foreign process. Names hinting
    at credentials are skipped, as this log is a plain file  */
export const debugLogEnv = (source: DebugSource, tool?: string): void => {
    const wanted = /^(?:PWD|OLDPWD|INIT_CWD|CD)$|COPILOT|CLAUDE|CODEX|WORKSPACE|PROJECT/i
    const secret = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i
    const vars   = Object.keys(process.env)
        .filter((name) => wanted.test(name) && !secret.test(name))
        .sort()
        .map((name) => `${name}=${(process.env[name] ?? "").slice(0, 120)}`)
    debugLog(source, `env: ${vars.length > 0 ? vars.join(", ") : "(no candidates)"}`, tool)
}
