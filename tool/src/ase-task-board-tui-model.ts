/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import fs                                     from "node:fs"
import os                                     from "node:os"
import path                                   from "node:path"

import React                                  from "react"
import { execa }                              from "execa"
import { useApp, useWindowSize, measureElement } from "ink"
import type { DOMElement }                    from "ink"

import type Log                               from "./ase-lib-log.js"
import { Task }                               from "./ase-task.js"
import {
    buildBoard, watchTasks, BoardState, byCreation, newTaskText, createTask, saveTask, TaskConflict, reachableStates, toneOf
}                                             from "./ase-task-board-core.js"
import type { Board, Card, Surface, SurfaceFlag, SurfaceList, SurfaceView, StoreState } from "./ase-task-board-core.js"
import * as TaskFormat                        from "./ase-task-format.js"
import { filterBoard, dropStandalone }        from "./ase-task-board-filter.js"
import { layoutGraph }                        from "./ase-task-board-graph.js"
import type { GraphLayout, Place }            from "./ase-task-board-graph.js"
import { fitGroups }                          from "./ase-task-board-tui-view.js"
import { dialogTabs, planLines, attachmentLines, DIALOG_CHROME, DIALOG_WIDTH } from "./ase-task-board-tui-popup.js"
import type { PlanParts }                     from "./ase-task-board-tui-popup.js"
import { pulseFrames }                        from "./ase-task-board-tui-style.js"

/*  the selection: group, lane, and card id ("" for a lane without card focus)  */
export type Sel = { g: number, l: number, id: string }

/*  the currently carried task (if any) and the lane states it can be moved to  */
export type Carry = { id: string, from: string, targets: Set<string> }

/*  the navigable items of a group: one per card, or one per lane
    which is minimized, empty, or within a collapsed group  */
export const groupItems = (board: Board, g: number, surface: Surface): Sel[] => {
    const out  = [] as Sel[]
    const coll = surface.collapsed.includes(board.groups[g].title)
    board.groups[g].lanes.forEach((lane, l) => {
        const cards = board.lanes.get(lane.status) ?? []
        if (coll || surface.minimized.includes(lane.status) || cards.length === 0)
            out.push({ g, l, id: "" })
        else
            cards.forEach((c) => out.push({ g, l, id: c.id }))
    })
    return out
}

/*  re-locate a selection on a (possibly changed) board: a selected card
    is followed into its current lane, otherwise the lane is kept  */
export const relocate = (board: Board, sel: Sel, surface: Surface): Sel => {
    if (sel.id !== "") {
        const card = board.cards.get(sel.id)
        if (card !== undefined)
            for (let g = 0; g < board.groups.length; g++) {
                const l = board.groups[g].lanes.findIndex((lane) => lane.status === card.status)
                if (l >= 0)
                    return surface.minimized.includes(card.status) || surface.collapsed.includes(board.groups[g].title) ?
                        { g, l, id: "" } : { g, l, id: card.id }
            }
    }
    const g     = Math.min(sel.g, board.groups.length - 1)
    const items = groupItems(board, g, surface)
    return items.find((it) => it.l === sel.l) ?? items[0]
}

/*  the entries of the transfer popup: all lane states (with their group), where
    only the current state and the states reachable from it are selectable  */
export type TransferEntry = { group: string, status: string, ok: boolean }
export const transferEntries = (board: Board, cycle: TaskFormat.TaskLifecycle, card: Card): TransferEntry[] => {
    const reachable = new Set(reachableStates(board, cycle, card))
    return board.groups.flatMap((g) => g.lanes.map((l) => ({
        group: g.title, status: l.status,
        ok:    l.status === card.status || reachable.has(l.status)
    })))
}

/*  the duration (in ms) a task store operation has to last before the busy popup shows it  */
export const BUSY_DELAY = 800

/*  the label of a busy task store operation: its text, the optional task id
    (rendered inverse), and an optional suffix  */
export type BusyLabel = { text: string, id?: string, suffix?: string }

/*  switch the mouse click reporting of the terminal (xterm, SGR encoding) on or off  */
export const mouseReporting = (on: boolean): void => {
    process.stdout.write(on ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1006l\x1b[?1000l")
}

/*  track the task store operations: once the oldest of the pending operations
    lasts longer than BUSY_DELAY, the modal busy popup shows it (with an animation tick)  */
const useBusy = () => {
    const pending = React.useRef(new Map<number, BusyLabel>())
    const seq     = React.useRef(0)
    const [ busy,     setBusy     ] = React.useState<{ label: BusyLabel, since: number } | null>(null)
    const [ busyTick, setBusyTick ] = React.useState(0)
    const track = <T>(label: BusyLabel, op: Promise<T>): Promise<T> => {
        const n = ++seq.current
        pending.current.set(n, label)
        const timer = setTimeout(() => {
            setBusy((b) => b ?? { label: pending.current.values().next().value ?? label, since: Date.now() - BUSY_DELAY })
        }, BUSY_DELAY)
        return op.finally(() => {
            clearTimeout(timer)
            pending.current.delete(n)
            const next = pending.current.values().next()
            setBusy((b) => b === null || next.done === true ? null : { ...b, label: next.value })
        })
    }
    React.useEffect(() => {
        if (busy === null)
            return
        const timer = setInterval(() => {
            setBusyTick((n) => n + 1)
        }, 50)
        return () => {
            clearInterval(timer)
        }
    }, [ busy ])
    return { busy, busyTick, track }
}

/*  the rendered boxes for the mouse hit-testing: the card, lane, and group boxes of the
    lane view, the view value and filter field of the header, and the graph viewport content  */
const useHitBoxes = () => {
    const cardBoxes  = React.useRef(new Map<string, DOMElement>())
    const laneBoxes  = React.useRef(new Map<string, DOMElement>())
    const groupBoxes = React.useRef(new Map<string, DOMElement>())
    const headBoxes  = React.useRef(new Map<string, DOMElement>())
    const graphView  = React.useRef<DOMElement | null>(null)
    const register   = (map: Map<string, DOMElement>, key: string) => (el: DOMElement | null) => {
        if (el !== null)
            map.set(key, el)
        else
            map.delete(key)
    }
    const cardRef    = (id: string) => register(cardBoxes.current, id)
    const laneRef    = (g: number, l: number) => register(laneBoxes.current, `${g}:${l}`)
    const groupRef   = (g: number) => register(groupBoxes.current, String(g))
    const headRef    = (key: "view" | "filter" | "clear") => register(headBoxes.current, key)
    return { cardBoxes, laneBoxes, groupBoxes, headBoxes, graphView, cardRef, laneRef, groupRef, headRef }
}

/*  find the registered box under a (0-based) mouse position  */
const boxAt = (map: Map<string, DOMElement>, mx: number, my: number): string | undefined => {
    for (const [ key, el ] of map) {
        const m = measureElement(el)
        if (mx >= m.x && mx < m.x + m.width && my >= m.y && my < m.y + m.height)
            return key
    }
    return undefined
}

/*  the state of the terminal board: all state, the derived values, and the actions  */
export const useBoardState = (log: Log, initial: Board) => {
    const { exit, suspendTerminal } = useApp()
    const { columns, rows } = useWindowSize()
    const [ all,     setBoard   ] = React.useState<Board>(initial)
    const [ surface, setSurface ] = React.useState<Surface>(() => BoardState.load().tui)
    const [ view,    setView    ] = React.useState<SurfaceView>(() => surface.view)
    const [ filter,  setFilter  ] = React.useState("")
    const [ typing,  setTyping  ] = React.useState(false)

    /*  the shown board: all tasks reduced onto the ones matching the filter
        query (plus, in the graph view, their direct dependencies as context,
        and optionally without the standalone tasks)  */
    const board = React.useMemo(() => {
        const found = filterBoard(all, filter, view === "graph")
        return view === "graph" && !surface.standalone ? dropStandalone(found) : found
    }, [ all, filter, view, surface.standalone ])
    const [ sel,     setSel     ] = React.useState<Sel>(() => relocate(board, { g: 0, l: 0, id: "" }, surface))
    const [ dialog,  setDialog  ] = React.useState<{ id: string, tab: number, first: number, scrolls: Record<number, number> } | null>(null)
    const [ plan,    setPlan    ] = React.useState<{ id: string, parts: PlanParts } | null>(null)
    const [ files,   setFiles   ] = React.useState<Map<string, Buffer | Error>>(new Map())
    const [ first,   setFirst   ] = React.useState(0)
    const [ scroll,  setScroll  ] = React.useState({ x: 0, y: 0 })
    const [ layout,  setLayout  ] = React.useState<{ board: Board, graph: GraphLayout, titles: boolean } | null>(null)
    const [ notice,  setNotice  ] = React.useState<string | null>(null)
    const [ carry,   setCarry   ] = React.useState<Carry | null>(null)
    const [ cycle,   setCycle   ] = React.useState<TaskFormat.TaskLifecycle | null>(null)
    const [ confirm, setConfirm ] = React.useState<{ id: string, yes: boolean } | null>(null)
    const [ transfer, setTransfer ] = React.useState<{ id: string, at: string } | null>(null)
    const [ store,   setStore   ] = React.useState<StoreState | null>(null)
    const [ grow,    setGrow    ] = React.useState(false)
    const editing = React.useRef(false)
    const drafts  = React.useRef(new Map<string, string>())

    /*  the busy popup of slow task store operations  */
    const { busy, busyTick, track } = useBusy()

    /*  the rendered boxes for the mouse hit-testing  */
    const { cardBoxes, laneBoxes, groupBoxes, headBoxes, graphView, cardRef, laneRef, groupRef, headRef } = useHitBoxes()

    /*  report mouse clicks while the board runs and mouse support is enabled
        (disabling it gives the regular text selection of the terminal back)  */
    const [ mouse, setMouse ] = React.useState(true)
    const mouseOn = React.useRef(true)
    const opening = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => {
        mouseOn.current = mouse
        mouseReporting(mouse)
        return () => {
            mouseReporting(false)
        }
    }, [ mouse ])
    React.useEffect(() => {
        return () => {
            if (opening.current !== null)
                clearTimeout(opening.current)
        }
    }, [])

    /*  fetch the task lifecycle model (for checking the moves of tasks)
        whenever the board and hence possibly its lifecycle mode changes  */
    React.useEffect(() => {
        let live = true
        Task.lifecycle(log).then((lifecycle) => {
            if (live)
                setCycle(lifecycle)
        }).catch((err: unknown) => {
            log.write("warning", `board: loading lifecycle failed: ${err instanceof Error ? err.message : String(err)}`)
        })
        return () => {
            live = false
        }
    }, [ log, all ])

    /*  persist the shown view for the next start of the terminal board  */
    React.useEffect(() => {
        BoardState.setView("tui", view).catch((err: unknown) => {
            log.write("warning", `board: persisting view failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }, [ log, view ])

    /*  auto-clear a status notice after 5 seconds  */
    React.useEffect(() => {
        if (notice === null)
            return
        const timer = setTimeout(() => {
            setNotice(null)
        }, 5 * 1000)
        return () => {
            clearTimeout(timer)
        }
    }, [ notice ])

    /*  drop a carried task if it vanished or changed its status in the meantime  */
    React.useEffect(() => {
        if (carry !== null && all.cards.get(carry.id)?.status !== carry.from) {
            setCarry(null)
            setNotice(`moving task "${carry.id}" cancelled: task changed in the meantime`)
        }
    }, [ all, carry ])

    /*  close the transfer popup if its task vanished in the meantime  */
    React.useEffect(() => {
        if (transfer !== null && !all.cards.has(transfer.id)) {
            setTransfer(null)
            setNotice(`transferring task "${transfer.id}" cancelled: task vanished in the meantime`)
        }
    }, [ all, transfer ])

    /*  remember the box of every graph node for the spatial navigation and the scrolling  */
    const places = React.useMemo(() => {
        const map = new Map<string, Place>()
        if (layout !== null)
            for (const n of layout.graph.nodes.values())
                map.set(n.id, { r: n.y + Math.floor(n.h / 2), c: n.x + Math.floor(n.w / 2), top: n.y, bottom: n.y + n.h - 1, bl: n.x, br: n.x + n.w - 1 })
        return map
    }, [ layout ])

    /*  follow changes of the task storage and of the lifecycle mode,
        and the kind and connection state of the task store
        (in the background, i.e. without the busy popup)  */
    React.useEffect(() => {
        const refresh = async () => {
            setBoard(await buildBoard(log))
        }
        const stop = watchTasks(log, refresh, setStore)
        return () => {
            stop().catch(() => {})
        }
    }, [ log ])

    /*  fetch the plan (with its attachments) of the read dialog whenever it is opened or the board changes
        (the latter in the background, i.e. without the busy popup)  */
    const dialogId  = dialog?.id
    const dialogTab = dialog?.tab ?? 0
    React.useEffect(() => {
        if (dialogId === undefined)
            return
        let live = true
        const load = Promise.all([ Task.parts(log, dialogId), Task.attachments(log, dialogId) ])
        const run  = plan?.id === dialogId ? load : track({ text: "loading task", id: dialogId }, load)
        run.then(([ parts, atts ]) => {
            if (live)
                setPlan({ id: dialogId, parts: parts === null ? null : { ...parts, atts } })
        }).catch((err: unknown) => {
            log.write("warning", `board: loading plan failed: ${err instanceof Error ? err.message : String(err)}`)
            if (live)
                setPlan({ id: dialogId, parts: err instanceof Error ? err : new Error(String(err)) })
        })
        return () => {
            live = false
        }
    }, [ log, all, dialogId ])

    /*  fetch the file content of the attachment of the selected tab, whenever the tab is selected or the plan changes
        (the latter in the background, i.e. without the busy popup)  */
    React.useEffect(() => {
        if (plan === null || plan.id !== dialogId)
            return
        const { id, parts } = plan
        if (parts === undefined || parts === null || parts instanceof Error)
            return
        const tab = Math.min(dialogTab, parts.atts.length)
        if (tab === 0 || parts.atts[tab - 1].file === undefined)
            return
        const key = `${id}:${tab}`
        let live = true
        const load = Task.attachmentContent(log, id, tab - 1)
        const run  = files.has(key) ? load : track({ text: "loading attachment of task", id }, load)
        run.then((content) =>
            content?.content ?? new Error("no such attachment content")
        ).catch((err: unknown) =>
            err instanceof Error ? err : new Error(String(err))
        ).then((content) => {
            if (live)
                setFiles((files) => new Map(files).set(key, content))
        })
        return () => {
            live = false
        }
    }, [ log, plan, dialogId, dialogTab ])

    /*  lay out the dependency graph whenever it is shown, the board changes,
        the showing of task titles is toggled, or the window width changes
        (as every task box gets a fixed quarter of the graph viewport width)  */
    const graphTitles = surface.titles
    const graphNodeW  = Math.max(12, Math.floor((columns - 6) / 4))
    React.useEffect(() => {
        if (view !== "graph")
            return
        let live = true
        layoutGraph(board, "cell", graphTitles, graphNodeW).then((g) => {
            if (live)
                setLayout({ board, graph: g, titles: graphTitles })
        }).catch((err: unknown) => {
            log.write("warning", `board: graph layout failed: ${err instanceof Error ? err.message : String(err)}`)
        })
        return () => {
            live = false
        }
    }, [ log, board, view, graphTitles, graphNodeW ])

    /*  toggle a minimized lane or a collapsed group of the TUI surface  */
    const toggle = (list: SurfaceList, entry: string): void => {
        BoardState.toggle("tui", list, entry).then((state) => {
            setSurface(state.tui)
        }).catch((err: unknown) => {
            log.write("warning", `board: toggling ${list} failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }

    /*  run $EDITOR on a text in a temporary file, handing the terminal over
        to the editor, and return the edited text  */
    const runEditor = async (name: string, text: string): Promise<string> => {
        const dir  = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ase-task-"))
        const file = path.join(dir, `${name}.md`)
        try {
            await fs.promises.writeFile(file, text, "utf8")

            /*  run $EDITOR through the shell (to support values with arguments or
                quoting), passing the file via the environment to avoid quoting it  */
            const editor = (process.env.EDITOR ?? "").trim() || "vi"
            const ref    = process.platform === "win32" ? "\"%ASE_TASK_FILE%\"" : "\"$ASE_TASK_FILE\""
            await suspendTerminal(async () => {
                mouseReporting(false)
                try {
                    await execa(`${editor} ${ref}`, { shell: true, stdio: "inherit", env: { ASE_TASK_FILE: file } })
                }
                finally {
                    mouseReporting(mouseOn.current)
                }
            })
            return await fs.promises.readFile(file, "utf8")
        }
        finally {
            await fs.promises.rm(dir, { recursive: true, force: true })
        }
    }

    /*  edit a task with $EDITOR; a draft which failed to save is kept and
        offered again on the next edit of the same task  */
    const edit = async (id: string): Promise<void> => {
        const src = await track({ text: "loading task", id }, Task.source(log, id))
        if (src === null) {
            setNotice(`task "${id}" no longer exists`)
            return
        }
        const text = await runEditor(id, drafts.current.get(id) ?? src.text)
        if (text === src.text) {
            drafts.current.delete(id)
            setNotice(`task "${id}" unchanged`)
            return
        }
        try {
            /*  conditionally save with the entity tag, to refuse overwriting changes
                made meanwhile by others (e.g. an agent or the web board)  */
            const { id: next, warning } = await track({ text: "saving task", id }, saveTask(log, id, text, src.tag))
            drafts.current.delete(id)
            if (next !== id) {
                setSel((s) => s.id === id ? { ...s, id: next } : s)
                setDialog((d) => d?.id === id ? { ...d, id: next } : d)
            }
            setNotice((next !== id ? `task "${id}" saved and renamed to "${next}"` : `task "${id}" saved`) +
                (warning !== "" ? ` (${warning})` : ""))
        }
        catch (err: unknown) {
            if (err instanceof TaskConflict) {
                if (err.tag === null) {
                    drafts.current.delete(id)
                    setNotice(`task "${id}" was deleted meanwhile (edit discarded)`)
                }
                else {
                    drafts.current.set(id, text)
                    setNotice(`task "${id}" was changed meanwhile (press "e" to re-edit and overwrite)`)
                }
                return
            }
            drafts.current.set(id, text)
            const msg = err instanceof Error ? err.message : String(err)
            setNotice(`saving task "${id}" failed: ${msg} (press "e" to re-edit)`)
        }
    }

    /*  create a new task with $EDITOR on its pre-filled text, under the id of
        its "Id:" key; an unchanged text creates no task, and a text which failed
        to save is kept as a draft (under the empty id) for the next new task  */
    const create = async (): Promise<void> => {
        const orig = drafts.current.get("") ?? await track<string>({ text: "preparing new task" },
            Task.lifecycle(log).then((lifecycle) => newTaskText(log, all, lifecycle)))
        const text = await runEditor("new-task", orig)
        if (text === orig) {
            drafts.current.delete("")
            setNotice("new task discarded")
            return
        }
        const id = TaskFormat.taskTextId(text)
        try {
            const warning = await track({ text: "creating task", id }, createTask(log, id, text))
            drafts.current.delete("")
            setSel((s) => ({ ...s, id }))
            setNotice(`task "${id}" created` + (warning !== "" ? ` (${warning})` : ""))
        }
        catch (err: unknown) {
            drafts.current.set("", text)
            const msg = err instanceof Error ? err.message : String(err)
            setNotice(`creating task failed: ${msg} (press "N" to re-edit)`)
        }
    }

    /*  delete a task (after its confirmation), closing its read dialog  */
    const remove = (id: string): void => {
        if (dialog?.id === id)
            setDialog(null)
        track({ text: "deleting task", id }, Task.delete(log, id)).then((existed) => {
            setNotice(existed ? `task "${id}" deleted` : `task "${id}" no longer exists`)
        }).catch((err: unknown) => {
            setNotice(`deleting task "${id}" failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }

    /*  transfer a task (from its popup) to a state, where its current state cancels  */
    const transferTo = (id: string, to: string): void => {
        setTransfer(null)
        if (to === all.cards.get(id)?.status) {
            setNotice(`transferring task "${id}" cancelled`)
            return
        }
        track({ text: "moving task", id, suffix: `to ${to}` }, Task.setStatus(log, id, to)).then((result) => {
            setNotice(`task "${id}" moved from ${result.from} to ${result.to}`)
        }).catch((err: unknown) => {
            setNotice(`moving task "${id}" failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }

    /*  drop a carried task onto a lane state, keeping it selected  */
    const drop = (id: string, to: string): void => {
        setCarry(null)
        track({ text: "moving task", id, suffix: `to ${to}` }, Task.setStatus(log, id, to)).then((result) => {
            setSel({ g: sel.g, l: sel.l, id })
            setNotice(`task "${id}" moved from ${result.from} to ${result.to}`)
        }).catch((err: unknown) => {
            setNotice(`moving task "${id}" failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }

    /*  edit an existing task, or create a new one (without id)  */
    const startEdit = (id: string | null) => {
        if (editing.current)
            return
        editing.current = true
        setNotice(null)
        const run = id !== null ? edit(id) : create()
        run.catch((err: unknown) => {
            setNotice(`${id !== null ? `editing task "${id}"` : "creating task"} failed: ${err instanceof Error ? err.message : String(err)}`)
        }).finally(() => {
            editing.current = false
        })
    }

    /*  toggle a flag (task titles, key hints, or standalone tasks) of the TUI surface  */
    const toggleFlag = (flag: SurfaceFlag): void => {
        BoardState.toggleFlag("tui", flag).then((state) => {
            setSurface(state.tui)
        }).catch((err: unknown) => {
            log.write("warning", `board: toggling ${flag} failed: ${err instanceof Error ? err.message : String(err)}`)
        })
    }

    /*  keep the selection valid on every board, surface, or view change
        (the graph view shows all nodes, so it ignores minimized lanes and collapsed groups)  */
    React.useEffect(() => {
        setSel((s) => relocate(board, s, view === "graph" ? { ...surface, minimized: [], collapsed: [] } : surface))
    }, [ board, surface, view ])

    /*  the selected lane is grown to the full board only while it is neither
        minimized nor within a collapsed group (else it shrinks back for good)  */
    const growable = board.groups[sel.g] !== undefined
        && !surface.collapsed.includes(board.groups[sel.g].title)
        && !surface.minimized.includes(board.groups[sel.g].lanes[sel.l]?.status ?? "")
    const grown    = grow && growable
    React.useEffect(() => {
        if (grow && !growable)
            setGrow(false)
    }, [ grow, growable ])

    const headH  = 3
    const footH  = surface.keys ? 6 : 3
    const boardH = rows - headH - footH
    const innerW = columns - 2

    /*  the tabs of the read dialog, the lines of its selected tab (clamped to
        the existing tabs), and the maximum scroll offset of these lines  */
    const dialogW     = Math.min(columns - 2, DIALOG_WIDTH)
    const dialogParts = dialog !== null && plan?.id === dialog.id ? plan.parts : undefined
    const tabLabels   = dialogTabs(dialogParts)
    const dialogSel   = Math.min(dialogTab, tabLabels.length - 1)
    const dialogAtt   = dialogSel > 0 && dialogParts !== undefined && dialogParts !== null && !(dialogParts instanceof Error) ?
        dialogParts.atts[dialogSel - 1] : undefined
    const dialogLines = dialog === null ? [] : dialogAtt !== undefined ?
        attachmentLines(dialogAtt, files.get(`${dialog.id}:${dialogSel}`), Math.max(1, dialogW - 5)) :
        planLines(dialogParts, dialog.id, Math.max(1, dialogW - 5))
    const dialogMax   = Math.max(0, dialogLines.length - (rows - DIALOG_CHROME))

    /*  the entries of the transfer popup of its (still existing) task  */
    const transferCard = transfer !== null ? all.cards.get(transfer.id) : undefined
    const transferList = transferCard !== undefined && cycle !== null ? transferEntries(all, cycle, transferCard) : []

    /*  scroll the selected tab of the read dialog  */
    const dialogScroll = (delta: number) => {
        if (dialog === null)
            return
        const scroll = Math.max(0, Math.min(dialogMax, (dialog.scrolls[dialogSel] ?? 0) + delta))
        setDialog({ ...dialog, scrolls: { ...dialog.scrolls, [dialogSel]: scroll } })
    }

    /*  determine the visible groups, following the selection
        (storing the derived state during rendering is idempotent)  */
    let fit = fitGroups(board.groups, surface.collapsed, Math.min(first, board.groups.length - 1), innerW)
    while (sel.g < fit.first)
        fit = fitGroups(board.groups, surface.collapsed, fit.first - 1, innerW)
    while (sel.g > fit.last && fit.first < board.groups.length - 1)
        fit = fitGroups(board.groups, surface.collapsed, fit.first + 1, innerW)
    if (fit.first !== first)
        setFirst(fit.first)

    /*  scroll the graph viewport so the box of the selected node stays visible  */
    const viewH = boardH - 2
    const viewW = innerW - 4
    let   { x, y } = scroll
    const box = view === "graph" ? places.get(sel.id) : undefined
    if (box !== undefined) {
        if (box.top < y)                   y = box.top
        if (box.bottom > y + viewH - 1)    y = box.bottom - viewH + 1
        if (box.bl < x)                    x = Math.max(0, box.bl - 2)
        if (box.br > x + viewW - 1)        x = box.br - viewW + 3
    }
    if (x !== scroll.x || y !== scroll.y)
        setScroll({ x, y })

    /*  the graph navigation order: by level, then by creation time  */
    const nodes = [ ...board.cards.values() ].sort((a, b) =>
        board.levels.get(a.id)! - board.levels.get(b.id)! || byCreation(a, b))

    /*  the board is dimmed while a dialog or popup is shown (incl. the busy popup)  */
    const dim = dialog !== null || confirm !== null || transfer !== null || busy !== null

    /*  pulse the tasks of active lanes (or the active nodes of the graph), but only while
        any of them (or its pulse) is actually visible, in order to not needlessly re-render the board  */
    const shown   = grown ? [ { ...board.groups[sel.g], lanes: [ board.groups[sel.g].lanes[sel.l] ] } ] : board.groups.slice(fit.first, fit.last + 1)
    const pulsing = !dim && (view === "lanes" ?
        shown.some((g) => !surface.collapsed.includes(g.title)
            && g.lanes.some((l) => l.active && !surface.minimized.includes(l.status) && (board.lanes.get(l.status)?.length ?? 0) > 0)) :
        layout !== null && [ ...layout.graph.nodes.values() ].some((n) => !layout.board.context.has(n.id)
            && toneOf(layout.board, layout.board.cards.get(n.id)!) === "active"
            && n.y >= y && n.y < y + viewH && n.x + n.w - 3 >= x && n.x + n.w - 3 < x + viewW))
    const [ pulseTick, setPulseTick ] = React.useState(0)
    React.useEffect(() => {
        if (!pulsing)
            return
        const timer = setInterval(() => {
            setPulseTick((n) => (n + 1) % pulseFrames.length)
        }, 250)
        return () => {
            clearInterval(timer)
        }
    }, [ pulsing ])
    const pulse = pulsing ? pulseTick : -1

    return {
        log, exit, columns, rows, all, board, surface, view, setView, filter, setFilter, typing, setTyping,
        sel, setSel, dialog, setDialog, scroll, layout, notice, setNotice, carry, setCarry, cycle,
        confirm, setConfirm, transfer, setTransfer, mouse, setMouse, opening, grown, setGrow,
        cardBoxes, laneBoxes, groupBoxes, headBoxes, cardRef, laneRef, groupRef, headRef, boxAt, graphView,
        places, graphTitles, boardH, dialogW, tabLabels, dialogSel, dialogLines, dialogScroll,
        transferCard, transferList, fit, viewH, viewW, x, y, nodes, dim, pulse, store, busy, busyTick,
        toggle, toggleFlag, startEdit, remove, transferTo, drop
    }
}

/*  the state of the terminal board, as shared by its controller and view  */
export type BoardCtx = ReturnType<typeof useBoardState>

