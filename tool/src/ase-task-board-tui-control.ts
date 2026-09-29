/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import { measureElement }                     from "ink"
import type { Key }                           from "ink"

import { reachableStates }                    from "./ase-task-board-core.js"
import { nearestPlace }                       from "./ase-task-board-graph.js"
import { groupItems, relocate }               from "./ase-task-board-tui-model.js"
import type { BoardCtx }                      from "./ase-task-board-tui-model.js"
import { gridColumns }                        from "./ase-task-board-tui-view.js"
import {
    refSegs, tabFirst, tabLayout, confirmBox, transferBox, CONFIRM_BUTTON, DIALOG_CHROME, DIALOG_CLOSE
}                                             from "./ase-task-board-tui-popup.js"

/*  handle a mouse press onto the deletion confirmation, the transfer popup,
    or the read dialog, returning whether one of them was open  */
const handlePopupMouse = (ctx: BoardCtx, btn: number, mx: number, my: number): boolean => {
    const {
        columns, rows, all, dialog, setDialog, setNotice, confirm, setConfirm, transfer, setTransfer,
        dialogW, tabLabels, dialogSel, dialogScroll, transferList, remove, transferTo
    } = ctx
    if (confirm !== null) {
        /*  a click onto the " delete " or " cancel " button of the deletion confirmation  */
        const box = confirmBox(columns, rows)
        if (btn === 0 && my === box.row && mx >= box.deleteX && mx < box.deleteX + CONFIRM_BUTTON) {
            remove(confirm.id)
            setConfirm(null)
        }
        else if (btn === 0 && my === box.row && mx >= box.cancelX && mx < box.cancelX + CONFIRM_BUTTON) {
            setNotice(`deleting task "${confirm.id}" cancelled`)
            setConfirm(null)
        }
        return true
    }
    if (transfer !== null) {
        /*  a click onto a selectable entry of the transfer popup transfers
            the task to its state, while a click outside the popup cancels  */
        const box = transferBox(transferList.length, transferList.findIndex((e) => e.status === transfer.at), columns, rows)
        const k   = box.first + my - box.row
        if (btn !== 0)
            return true
        if (mx < box.left || mx >= box.left + box.width || my < box.top || my >= box.top + box.height) {
            setNotice(`transferring task "${transfer.id}" cancelled`)
            setTransfer(null)
        }
        else if (k >= box.first && k < box.first + box.viewH && transferList[k]?.ok)
            transferTo(transfer.id, transferList[k].status)
        return true
    }
    if (dialog !== null) {
        /*  a click onto the " X " of the header (the second dialog row) closes  */
        const barX   = Math.floor((columns - dialogW) / 2) + 1
        const closeX = barX - 1 + dialogW - DIALOG_CLOSE
        if (btn === 0 && my === 1 && mx >= closeX && mx < closeX + 3)
            setDialog(null)
        else if (btn === 0 && my === 3 && mx >= barX && mx < barX + dialogW - 2) {
            /*  a click onto a predecessor or successor id (in the fourth dialog row) jumps to its task view  */
            let x = barX
            for (const seg of refSegs(all.pred.get(dialog.id) ?? [], all.succ.get(dialog.id) ?? [], () => undefined, dialogW - 2)) {
                if (mx >= x && mx < x + seg.text.length) {
                    if (seg.ref !== undefined && all.cards.has(seg.ref))
                        setDialog({ id: seg.ref, tab: 0, first: 0, scrolls: {} })
                    break
                }
                x += seg.text.length
            }
        }
        else if (btn === 0 && my === 5 && mx >= barX && mx < barX + dialogW - 2) {
            /*  a click onto the tab bar (the sixth dialog row) selects the clicked
                tab, or the previous/next tab on a scroll arrow, but never closes  */
            const lay  = tabLayout(tabLabels, dialog.first, dialogSel, dialogW - 2)
            const x    = mx - barX
            const item = lay.items.find((it) => x >= it.x && x < it.x + it.text.length)
            let   tab  = dialogSel
            if (item !== undefined)
                tab = item.index
            else if (x === 0 && lay.less)
                tab = dialogSel - 1
            else if (x === dialogW - 3 && lay.more)
                tab = dialogSel + 1
            if (tab !== dialogSel)
                setDialog({ ...dialog, tab, first: tabFirst(tabLabels, dialog.first, tab, dialogW - 4) })
        }
        else if (btn === 64 || btn === 65)
            dialogScroll(btn === 64 ? -3 : 3)
        return true
    }
    return false
}

/*  handle a mouse press (0-based column/row, button 0: left press,
    64/65: wheel up/down): a click opens the clicked task, while a
    click onto its " X " closes an open task view, a click onto a
    predecessor/successor id jumps to its task view, and the wheel scrolls it  */
export const handleMouse = (ctx: BoardCtx, btn: number, mx: number, my: number): void => {
    const {
        board, surface, view, setView, setFilter, typing, setTyping, sel, setSel, setDialog, scroll, layout,
        carry, setCarry, opening, cardBoxes, laneBoxes, groupBoxes, headBoxes, boxAt, graphView, toggle, grown, setGrow
    } = ctx
    if (handlePopupMouse(ctx, btn, mx, my))
        return

    /*  a click onto the view value of the header switches the view, a click
        onto the filter field starts typing into it (unless a task is moved),
        a click onto its clear button clears it, and any other click ends
        typing (keeping the filter query)  */
    const head = btn === 0 ? boxAt(headBoxes.current, mx, my) : undefined
    if (typing && head !== "filter")
        setTyping(false)
    if (head === "clear") {
        setFilter("")
        return
    }
    if (head === "view") {
        setCarry(null)
        setView(view === "lanes" ? "graph" : "lanes")
        return
    }
    if (head === "filter") {
        if (carry === null)
            setTyping(true)
        return
    }
    if ((btn === 64 || btn === 65) && view === "lanes") {
        /*  the wheel over a lane scrolls it, by stepping the selection
            through its cards (entering the lane at its first card)  */
        const at = boxAt(laneBoxes.current, mx, my)
        if (at === undefined)
            return
        const [ g, l ] = at.split(":").map(Number)
        const lane = board.groups[g].lanes[l]
        const list = board.lanes.get(lane.status) ?? []
        if (list.length === 0 || surface.minimized.includes(lane.status) || surface.collapsed.includes(board.groups[g].title))
            return
        const idx  = sel.g === g && sel.l === l ? list.findIndex((c) => c.id === sel.id) : -1
        const next = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + (btn === 64 ? -1 : 1)))
        setSel({ g, l, id: list[next].id })
        return
    }
    if (btn !== 0)
        return

    /*  a click onto a lane outside its cards (and while moving a task,
        anywhere onto a lane) selects the lane, like PgUp/PgDn, where a click
        onto the title of a group collapses/expands the group, a click onto the
        title of a lane minimizes/maximizes the lane, and a click onto a lane
        of a collapsed group expands the group  */
    const card = view === "lanes" && carry === null ? boxAt(cardBoxes.current, mx, my) : undefined
    if (view === "lanes" && card === undefined) {
        const grp = boxAt(groupBoxes.current, mx, my)
        if (grp !== undefined && my === measureElement(groupBoxes.current.get(grp)!).y) {
            toggle("collapsed", board.groups[Number(grp)].title)
            return
        }
        const at = boxAt(laneBoxes.current, mx, my)
        if (at !== undefined) {
            const [ g, l ] = at.split(":").map(Number)
            if (surface.collapsed.includes(board.groups[g].title))
                toggle("collapsed", board.groups[g].title)
            else if (my === measureElement(laneBoxes.current.get(at)!).y + 1 && grown)
                setGrow(false)
            else if (my === measureElement(laneBoxes.current.get(at)!).y + 1)
                toggle("minimized", board.groups[g].lanes[l].status)
            const next = groupItems(board, g, surface).find((it) => it.l === l)
            if (next !== undefined && !(sel.g === g && sel.l === l))
                setSel(next)
        }
        return
    }
    if (carry !== null)
        return
    let hit: string | undefined
    if (view === "lanes")
        hit = card
    else if (layout !== null && graphView.current !== null) {
        /*  map the click into the graph grid via the measured viewport origin  */
        const m  = measureElement(graphView.current)
        const gx = mx - m.x + scroll.x
        const gy = my - m.y + scroll.y
        for (const n of layout.graph.nodes.values())
            if (gx >= n.x && gx < n.x + n.w && gy >= n.y && gy < n.y + n.h)
                hit = n.id
    }
    if (hit !== undefined && board.cards.has(hit)) {
        /*  first visibly select the clicked task, then shortly afterwards open its view  */
        const id = hit
        setSel(relocate(board, { g: sel.g, l: sel.l, id },
            view === "graph" ? { ...surface, minimized: [], collapsed: [] } : surface))
        if (opening.current !== null)
            clearTimeout(opening.current)
        opening.current = setTimeout(() => {
            opening.current = null
            setDialog({ id, tab: 0, first: 0, scrolls: {} })
        }, 150)
    }
}

/*  handle a key press onto the deletion confirmation, the transfer
    popup, or the filter field (outside of the read dialog)  */
const handlePopupKey = (ctx: BoardCtx, input: string, key: Key): void => {
    const {
        dialog, setFilter, typing, setTyping, setNotice, confirm, setConfirm,
        transfer, setTransfer, transferList, remove, transferTo
    } = ctx

    /*  answer the confirmation of a task deletion: "y" deletes, ESC cancels, the
        left/right arrows and TAB/Shift+TAB switch the selected button, RETURN
        presses it, and all other keys are ignored  */
    if (confirm !== null) {
        if (input === "y" || (key.return && confirm.yes)) {
            remove(confirm.id)
            setConfirm(null)
        }
        else if (key.escape || key.return) {
            setNotice(`deleting task "${confirm.id}" cancelled`)
            setConfirm(null)
        }
        else if (key.leftArrow || key.rightArrow || key.tab)
            setConfirm({ ...confirm, yes: !confirm.yes })
        return
    }

    /*  answer the transfer popup: the up/down arrows select the previous/next
        selectable state, RETURN transfers the task to it, ESC cancels, and all
        other keys are ignored  */
    if (transfer !== null) {
        if (key.upArrow || key.downArrow) {
            const step = key.upArrow ? -1 : 1
            for (let k = transferList.findIndex((e) => e.status === transfer.at) + step; k >= 0 && k < transferList.length; k += step)
                if (transferList[k].ok) {
                    setTransfer({ ...transfer, at: transferList[k].status })
                    break
                }
        }
        else if (key.return)
            transferTo(transfer.id, transfer.at)
        else if (key.escape) {
            setNotice(`transferring task "${transfer.id}" cancelled`)
            setTransfer(null)
        }
        return
    }

    /*  while typing into the filter field, all keys edit the filter query
        (applied live), until ENTER keeps it or ESC clears it  */
    if (typing && dialog === null) {
        if (key.return)
            setTyping(false)
        else if (key.escape) {
            setFilter("")
            setTyping(false)
        }
        else if (key.backspace || key.delete)
            setFilter((f) => f.slice(0, -1))
        else if (!key.ctrl && !key.meta && !/\p{Cc}/u.test(input))
            setFilter((f) => f + input)
    }
}

/*  handle a key press within the read dialog  */
const handleDialogKey = (ctx: BoardCtx, dialog: NonNullable<BoardCtx["dialog"]>, input: string, key: Key): void => {
    const { rows, setDialog, dialogW, tabLabels, dialogSel, dialogScroll, startEdit } = ctx
    const page = Math.max(1, rows - DIALOG_CHROME - 2)
    if (key.escape || key.return)
        setDialog(null)
    else if (input === "e")
        startEdit(dialog.id)
    else if (key.leftArrow || key.rightArrow || key.tab) {
        const tab = Math.max(0, Math.min(tabLabels.length - 1, dialogSel + (key.leftArrow || (key.tab && key.shift) ? -1 : 1)))
        setDialog({ ...dialog, tab, first: tabFirst(tabLabels, dialog.first, tab, dialogW - 4) })
    }
    else if (key.upArrow)
        dialogScroll(-1)
    else if (key.downArrow)
        dialogScroll(1)
    else if (key.pageUp)
        dialogScroll(-page)
    else if (key.pageDown)
        dialogScroll(page)
}

/*  handle a key press within the lane view: moving and growing, else navigating  */
const handleLaneKey = (ctx: BoardCtx, input: string, key: Key): void => {
    const { columns, board, surface, sel, setSel, setNotice, carry, setCarry, cycle, drop, grown, setGrow, boardH } = ctx
    if (key.escape && carry !== null) {
        /*  cancel the move and return the selection to the task at its original position  */
        setCarry(null)
        setSel(relocate(board, { g: sel.g, l: sel.l, id: carry.id }, surface))
        setNotice(`moving task "${carry.id}" cancelled`)
        return
    }
    if (input === " ") {
        /*  pick up the selected task, determining all lanes whose state
            is directly or indirectly reachable from its current state  */
        if (carry === null) {
            const card = board.cards.get(sel.id)
            if (card === undefined)
                return
            if (cycle === null) {
                setNotice("task lifecycle model not yet loaded")
                return
            }
            const targets = new Set(reachableStates(board, cycle, card))
            setCarry({ id: card.id, from: card.status, targets })
            setGrow(false)
            return
        }

        /*  drop the carried task onto the selected lane, if reachable  */
        if (surface.collapsed.includes(board.groups[sel.g].title))
            return
        const to = board.groups[sel.g].lanes[sel.l].status
        if (to === carry.from) {
            setCarry(null)
            setNotice(`moving task "${carry.id}" cancelled`)
            return
        }
        if (!carry.targets.has(to)) {
            setNotice(`task "${carry.id}" cannot move from ${carry.from} to ${to}: not reachable in the lifecycle model`)
            return
        }
        drop(carry.id, to)
        return
    }
    if (input === "g") {
        /*  grow the selected lane to the full board, or shrink it back again  */
        if (carry !== null)
            return
        if (!grown && (surface.collapsed.includes(board.groups[sel.g].title)
            || surface.minimized.includes(board.groups[sel.g].lanes[sel.l].status)))
            setNotice("only a maximized lane of an expanded group can grow")
        else
            setGrow(!grown)
        return
    }
    if (grown) {
        /*  within the grown lane, the arrows step through the grid of its cards,
            PgUp/PgDn step by (roughly) the visible rows, Home/End jump to the
            first/last card, ESC shrinks the lane, and the other lane keys are ignored  */
        if (key.escape) {
            setGrow(false)
            return
        }
        const list = board.lanes.get(board.groups[sel.g].lanes[sel.l].status) ?? []
        const cols = gridColumns(columns - 2)
        const page = cols * Math.max(1, Math.floor((boardH - 4) / (surface.titles ? 5 : 3)))
        const step = key.leftArrow ? -1 : key.rightArrow ? 1 : key.upArrow ? -cols : key.downArrow ? cols :
            key.pageUp ? -page : key.pageDown ? page : key.home ? -list.length : key.end ? list.length : 0
        const idx  = list.findIndex((c) => c.id === sel.id)
        if (step === 0 || list.length === 0 || (key.upArrow && idx >= 0 && idx < cols))
            return
        const next = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + step))
        setSel({ g: sel.g, l: sel.l, id: list[next].id })
        return
    }
    handleNavKey(ctx, input, key)
}

/*  handle a key press navigating the lanes and groups of the lane view  */
const handleNavKey = (ctx: BoardCtx, input: string, key: Key): void => {
    const { board, surface, sel, setSel, carry, toggle } = ctx
    if (input === "m" && !key.shift) {
        if (surface.collapsed.includes(board.groups[sel.g].title))
            return
        const lane = board.groups[sel.g].lanes[sel.l]
        toggle("minimized", lane.status)
        return
    }
    if (input === "c") {
        toggle("collapsed", board.groups[sel.g].title)
        return
    }
    if (key.leftArrow || key.rightArrow) {
        const g = Math.max(0, Math.min(board.groups.length - 1, sel.g + (key.leftArrow ? -1 : 1)))
        if (g !== sel.g) {
            const items = groupItems(board, g, surface)
            setSel(items.find((it) => it.l === sel.l) ?? items[0])
        }
        return
    }
    if ((key.home || key.end) && carry === null) {
        /*  jump to the first or last item of the selected lane, scrolling it to its top or bottom  */
        const items = groupItems(board, sel.g, surface).filter((it) => it.l === sel.l)
        const next  = key.home ? items[0] : items[items.length - 1]
        if (next !== undefined)
            setSel(next)
        return
    }
    if ((key.upArrow || key.downArrow) && carry === null) {
        /*  within a collapsed group, the items are the lanes themselves  */
        const items = groupItems(board, sel.g, surface)
        const idx   = items.findIndex((it) => it.l === sel.l && it.id === sel.id)
        const next  = items[Math.max(0, Math.min(items.length - 1, idx + (key.upArrow ? -1 : 1)))]
        if (next !== undefined)
            setSel(next)
        return
    }
    if (key.pageUp || key.pageDown || key.upArrow || key.downArrow) {
        /*  jump directly to the first item of the upper or lower lane of the group
            (while moving a task, also on up/down, as only the target lane matters)  */
        const up   = key.pageUp || key.upArrow
        const l    = Math.max(0, Math.min(board.groups[sel.g].lanes.length - 1, sel.l + (up ? -1 : 1)))
        const next = groupItems(board, sel.g, surface).find((it) => it.l === l)
        if (next !== undefined && l !== sel.l)
            setSel(next)
        return
    }
    if (key.tab) {
        /*  step through the lanes of the expanded groups row by row: first
            left/right through the groups, then wrap into the next/previous
            row of lanes (and at the very end/start around the board)  */
        const rows  = Math.max(...board.groups.map((g) => g.lanes.length))
        const lanes = [] as { g: number, l: number }[]
        for (let l = 0; l < rows; l++)
            board.groups.forEach((group, g) => {
                if (l < group.lanes.length && !surface.collapsed.includes(group.title))
                    lanes.push({ g, l })
            })
        if (lanes.length === 0)
            return
        const idx    = lanes.findIndex((p) => p.g === sel.g && p.l === sel.l)
        const target = idx < 0 ? lanes[key.shift ? lanes.length - 1 : 0] :
            lanes[(idx + (key.shift ? lanes.length - 1 : 1)) % lanes.length]
        const next   = groupItems(board, target.g, surface).find((it) => it.l === target.l)
        if (next !== undefined)
            setSel(next)
    }
}

/*  handle a key press  */
export const handleKey = (ctx: BoardCtx, input: string, key: Key): void => {
    const {
        exit, all, board, surface, view, setView, typing, setTyping, sel, setSel, dialog, setDialog,
        notice, setNotice, carry, setCarry, cycle, confirm, setConfirm, transfer, setTransfer,
        mouse, setMouse, places, nodes, toggleFlag, startEdit
    } = ctx
    if (notice !== null)
        setNotice(null)

    /*  answer the deletion confirmation, the transfer popup, or the filter field  */
    if (confirm !== null || transfer !== null || (typing && dialog === null)) {
        handlePopupKey(ctx, input, key)
        return
    }

    /*  toggle the mouse support in every view (under the kitty keyboard
        protocol, Shift+m arrives as "m" with the shift modifier)  */
    if (input === "M" || (input === "m" && key.shift)) {
        setMouse(!mouse)
        setNotice(mouse ? "mouse support disabled: regular text selection available" : "mouse support enabled")
        return
    }

    /*  request the deletion of a task in every view (under the kitty keyboard
        protocol, Shift+d arrives as "d" with the shift modifier)  */
    const target = dialog !== null ? dialog.id : sel.id
    if ((input === "D" || (input === "d" && key.shift)) && target !== "" && carry === null) {
        setConfirm({ id: target, yes: false })
        return
    }

    /*  request the transfer of a task to another state in every view, starting
        at its current state (under the kitty keyboard protocol, Shift+t
        arrives as "t" with the shift modifier)  */
    if ((input === "T" || (input === "t" && key.shift)) && target !== "" && carry === null) {
        const card = all.cards.get(target)
        if (cycle === null)
            setNotice("task lifecycle model not yet loaded")
        else if (card !== undefined)
            setTransfer({ id: card.id, at: card.status })
        return
    }
    if (dialog !== null) {
        handleDialogKey(ctx, dialog, input, key)
        return
    }
    if (input === "q") {
        exit()
        return
    }
    if (input === "/") {
        if (carry === null)
            setTyping(true)
        return
    }
    if (input === "v") {
        setCarry(null)
        setView(view === "lanes" ? "graph" : "lanes")
        return
    }
    if (key.return && sel.id !== "") {
        setDialog({ id: sel.id, tab: 0, first: 0, scrolls: {} })
        return
    }
    if (input === "e") {
        if (sel.id !== "")
            startEdit(sel.id)
        return
    }
    if (input === "N" || (input === "n" && key.shift)) {
        if (carry === null)
            startEdit(null)
        return
    }
    if ((input === "t" && !key.shift) || input === "?") {
        toggleFlag(input === "t" ? "titles" : "keys")
        return
    }
    if (input === "s" && view === "graph") {
        toggleFlag("standalone")
        return
    }
    if (view === "graph") {
        /*  move spatially to the nearest node in the direction of the arrow  */
        const dir = key.leftArrow ? "left" : key.rightArrow ? "right" : key.upArrow ? "up" : key.downArrow ? "down" : null
        if (dir === null)
            return
        const next = places.has(sel.id) ? nearestPlace(places, sel.id, dir) : nodes[0]?.id
        if (next !== undefined && board.cards.has(next))
            setSel(relocate(board, { g: sel.g, l: sel.l, id: next }, { ...surface, minimized: [], collapsed: [] }))
        return
    }
    handleLaneKey(ctx, input, key)
}

