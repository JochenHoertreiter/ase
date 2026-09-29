/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import React                                  from "react"
import { Box, Text }                          from "ink"
import type { BoxProps, DOMElement }          from "ink"

import { splitHeight, toneOf, cardLabel, clampLines, glueId, glueTitle } from "./ase-task-board-core.js"
import type { Board, Card, GroupSpec, LaneSpec, Surface } from "./ase-task-board-core.js"
import { drawGraphText }                      from "./ase-task-board-graph.js"
import type { BoardCtx, Sel, Carry }          from "./ase-task-board-tui-model.js"
import { palette, dashed, dashedBold, cx, isClass, pulseFrames } from "./ase-task-board-tui-style.js"

/*  shorthand for creating React elements without JSX  */
export const h = React.createElement

/*  layout constants: minimum group width, collapsed group width, gap  */
const GROUP_MIN  = 26
const GROUP_COLL = 5
const GROUP_GAP  = 1

/*  layout constants of a grown lane: minimum card width, gap between cards  */
const GRID_MIN   = 30
const GRID_GAP   = 1

/*  compute the visible group range starting at a first group, with the
    width of each visible group (collapsed groups stay narrow, expanded
    groups share the remaining width but never drop below the minimum)  */
export const fitGroups = (groups: GroupSpec[], collapsed: string[], first: number, width: number) => {
    const widths = [] as number[]
    let   used   = 0
    for (let g = first; g < groups.length; g++) {
        const w   = collapsed.includes(groups[g].title) ? GROUP_COLL : GROUP_MIN
        const gap = widths.length > 0 ? GROUP_GAP : 0
        if (widths.length > 0 && used + gap + w > width)
            break
        widths.push(w)
        used += gap + w
    }
    const expanded = widths.map((w, i) => w === GROUP_COLL && collapsed.includes(groups[first + i].title) ? -1 : i)
        .filter((i) => i >= 0)
    if (expanded.length > 0) {
        const extra = Math.max(0, width - used)
        const each  = Math.floor(extra / expanded.length)
        expanded.forEach((i) => { widths[i] += each })
        widths[expanded[0]] += extra - each * expanded.length
    }
    return { first, last: first + widths.length - 1, widths }
}

/*  the rendering context of the lane view, with the currently carried
    task (if any) and the lane states it can be moved to, the groups
    whose lanes show a scroll arrow on their left or right border (or -1),
    the current pulse frame of the tasks of active lanes (or -1),
    and the registration of the rendered card, lane, and group boxes for the mouse hit-testing  */
type ViewCtx = {
    board: Board, surface: Surface, sel: Sel, dim: boolean, carry: Carry | null, titles: boolean, scroll: Scroll, pulse: number,
    cardRef:  (id: string) => (el: DOMElement | null) => void
    laneRef:  (g: number, l: number) => (el: DOMElement | null) => void
    groupRef: (g: number) => (el: DOMElement | null) => void
}
type Scroll  = { left: number, right: number }

/*  the scroll arrows of a lane box, attached outside to the vertical middle
    of its side borders (in the side padding of the board), placed either
    within the bordered box itself (whose offsets start inside the border)
    or within an unbordered wrapper around it  */
const scrollArrows = ({ scroll, dim }: ViewCtx, g: number, height: number, wrapper = false) => {
    const off = wrapper ? -1 : -2
    const top = Math.max(0, Math.floor((height - 2) / 2)) + (wrapper ? 1 : 0)
    return [
        ...(scroll.left  === g ? [ h(Box, { key: "scroll-left",  position: "absolute", left:  off, top },
            h(Text, cx("dim", "bold", dim && "dimmed"), "◁")) ] : []),
        ...(scroll.right === g ? [ h(Box, { key: "scroll-right", position: "absolute", right: off, top },
            h(Text, cx("dim", "bold", dim && "dimmed"), "▷")) ] : [])
    ]
}

/*  the label lines of a card of a width: the task id (with its markers) and title,
    cut onto a single line, or if titles are shown, wrapped onto at most
    three lines (with an ellipsis if cut), padded by one column on each side,
    with a placeholder column glued in front of the task id to reserve
    the extra column of its inverse rendering, and the arrow in front of
    the title replaced by a placeholder column glued to the title  */
const cardLines = ({ board, titles }: ViewCtx, c: Card, width: number): string[] => {
    const textW = Math.max(3, width - 2)
    const marks = board.cyclic.has(c.id) ? " ⟲" : ""
    const text  = glueId + c.id + marks + cardLabel(c).slice(c.id.length).replace(/^ ▶ /, ` ${glueTitle}`)
    return clampLines(text, textW - 2, titles ? 3 : 1).map((line) => ` ${line}`)
}

/*  render one card of a width and height (in rows) of a lane, either regularly,
    as the carried task on top of the selected target lane (moving), or as the
    dim ghost of the carried task at its original position (phantom)  */
const renderCard = (ctx: ViewCtx, lane: LaneSpec, c: Card, lines: string[], width: number, rows: number,
    cut: "none" | "top" | "bottom", moving: boolean, phantom: boolean) => {
    const { board, sel, dim, carry } = ctx
    const held    = carry?.id === c.id && !phantom
    const on      = (c.id === sel.id || moving) && !dim && !phantom
    const tone    = toneOf(board, c)
    const tint    = phantom ? palette.dim : on ? palette.signal : tone === "active" ? palette.accent : tone === "done" ? palette.dim : palette.normal

    /*  the task id at the start of the first line (behind the margin and
        the placeholder) is always bold and inverse, with one column of
        spacing on each side, directly followed by the rest of the label,
        where a partially visible card loses its cut border and text lines  */
    const to      = 2 + c.id.length
    const box     = {
        key: moving ? "moving" : c.id, ...(moving ? {} : { ref: ctx.cardRef(c.id) }),
        borderStyle: phantom ? dashed : held ? "double" : "single", borderColor: tint, borderDimColor: dim,
        borderTop: cut !== "top", borderBottom: cut !== "bottom", width, height: rows, flexDirection: "column"
    } as const
    const text    = lines.map((line, k) => h(Text, { key: k, color: tint, dimColor: dim, wrap: "truncate" },
        ...(k === 0 ? [ line.slice(0, 1), h(Text, { key: "id", ...cx("badge") }, ` ${line.slice(2, to)} `),
            line.slice(to + 1).replace(new RegExp(`^${glueTitle}`), " ").replace(glueTitle, "") ] : [ line.replace(glueTitle, "") ])))
        .slice(cut === "top" ? lines.length + 1 - rows : 0, cut === "bottom" ? rows - 1 : lines.length)
    if (!lane.active || ctx.pulse < 0 || moving || phantom || cut === "top")
        return h(Box, box, ...text)

    /*  the tasks of active lanes pulse in their top border, which hence
        is drawn on its own above the box without its regular top border  */
    const [ cl, cm, cr ] = held ? [ "╔", "═", "╗" ] : [ "┌", "─", "┐" ]
    const top     = cl + cm.repeat(Math.max(0, width - 4)) + pulseFrames[ctx.pulse] + cm + cr
    return h(Box, { key: box.key, ref: ctx.cardRef(c.id), width, height: rows, flexDirection: "column" },
        h(Text, { color: tint, dimColor: dim, wrap: "truncate" }, top),
        ...(rows > 1 ? [ h(Box, { ...box, key: "box", ref: undefined, borderTop: false, height: rows - 1 }, ...text) ] : []))
}

/*  render one lane of the lane view  */
const renderLane = (ctx: ViewCtx, lane: LaneSpec, g: number, l: number, width: number, height: number) => {
    const { board, surface, sel, dim, carry } = ctx
    const cards   = board.lanes.get(lane.status) ?? []
    const color   = lane.active ? palette.accent : lane.kind === "terminal" ? palette.dim : palette.normal
    const target  = carry?.targets.has(lane.status) ?? false
    const min     = surface.minimized.includes(lane.status)

    /*  a signal-colored border marks the selected lane, and a heavy border marks
        the selected lane or, while moving a task, the target lanes instead  */
    const picked  = sel.g === g && sel.l === l
    const heavy   = carry !== null ? target : picked
    const style: BoxProps["borderStyle"] = lane.dashed ? (heavy ? dashedBold : dashed) : (heavy ? "bold" : "round")
    const frame   = { key: lane.status, borderStyle: style, borderColor: picked ? palette.signal : color, borderDimColor: dim }
    const head    = h(Box, { key: "head", justifyContent: "space-between", paddingX: 1 },
        h(Text, { color, bold: true, dimColor: dim, wrap: "truncate" },
            `${min ? "▶" : "▼"} ${lane.status}`),
        h(Text, { color, dimColor: dim }, String(cards.length)))
    if (min)
        return h(Box, { ...frame, ref: ctx.laneRef(g, l), width, height: 3, flexDirection: "column" }, head, ...scrollArrows(ctx, g, 3))

    /*  while moving a task onto a reachable target lane, the carried task is
        shown on top of the selected target lane, while a dim ghost of it
        stays at its original position until the drop happens  */
    const moved   = carry !== null && carry.targets.has(board.groups[sel.g]?.lanes[sel.l]?.status ?? "")
    const carried = moved && picked ? board.cards.get(carry.id) : undefined
    const list    = carried !== undefined ? [ carried, ...cards ] : cards

    /*  determine the visible cards by their actual heights, keeping the
        selected card (or the carried task instead) visible and, if not all
        cards fit, reserving one line for the indicator of the hidden cards  */
    const labels  = list.map((c) => cardLines(ctx, c, width - 2))
    const heights = labels.map((lines) => lines.length + 2)
    const sum     = (a: number, b: number) => heights.slice(a, b).reduce((n, x) => n + x, 0)
    const room    = height - 3
    const idx     = carried !== undefined ? 0 : list.findIndex((c) => c.id === sel.id)
    let   start   = 0
    let   end     = list.length
    if (sum(0, list.length) > room) {
        end = 0
        while (end < list.length && sum(0, end + 1) <= room - 1)
            end++
        if (idx >= end) {
            start = idx
            end   = idx + 1
            while (start > 0 && sum(start - 1, end) <= room - 1)
                start--
        }
    }
    const rest  = list.length - end

    /*  the space left besides the fully visible cards is filled by a partially
        visible card, cut at its top above them if scrolled, else cut at its bottom below them  */
    const part  = start > 0 || rest > 0 ? room - 1 - sum(start, end) : 0
    const cuts  = [
        ...(part > 0 && start > 0 ? [ { n: start - 1, cut: "top"    as const, rows: part } ] : []),
        ...list.slice(start, end).map((_c, i) => ({ n: start + i, cut: "none" as const, rows: heights[start + i] })),
        ...(part > 0 && start === 0 ? [ { n: end, cut: "bottom" as const, rows: part } ] : [])
    ]
    const items = cuts.map(({ n, cut, rows }) => {
        const moving  = carried !== undefined && n === 0
        const phantom = moved && !moving && list[n].id === carry?.id
        return renderCard(ctx, lane, list[n], labels[n], width - 2, rows, cut, moving, phantom)
    })

    /*  the centered indicator of the hidden cards, pushed to the bottom of the lane by a growing spacer  */
    if (start > 0 || rest > 0)
        items.push(h(Box, { key: "spacer", flexGrow: 1 }),
            h(Box, { key: "more", justifyContent: "center" },
                h(Text, cx("dim", dim && "dimmed"),
                    [ ...(start > 0 ? [ `△ ${start}` ] : []), ...(rest > 0 ? [ `▽ ${rest}` ] : []) ].join(" "))))
    return h(Box, { ...frame, ref: ctx.laneRef(g, l), width, height, flexDirection: "column" }, head, ...items, ...scrollArrows(ctx, g, height))
}

/*  the number of grid columns of the cards of a grown lane of a width:
    at least four, but more if the cards then still keep their minimum width  */
export const gridColumns = (width: number) =>
    Math.max(4, Math.floor((width - 4 + GRID_GAP) / (GRID_MIN + GRID_GAP)))

/*  render the grown lane of the lane view: all its cards in a grid of rows,
    all cards of a row having the height of its highest card, where only
    the rows fitting into the lane are shown, keeping the selected card visible  */
const renderGrown = (ctx: ViewCtx, lane: LaneSpec, g: number, l: number, width: number, height: number) => {
    const { board, sel, dim } = ctx
    const cards   = board.lanes.get(lane.status) ?? []
    const color   = lane.active ? palette.accent : lane.kind === "terminal" ? palette.dim : palette.normal
    const style: BoxProps["borderStyle"] = lane.dashed ? dashedBold : "bold"
    const head    = h(Box, { key: "head", justifyContent: "space-between", paddingX: 1 },
        h(Text, { color, bold: true, dimColor: dim, wrap: "truncate" }, `◆ ${lane.status}`),
        h(Text, { color, dimColor: dim }, String(cards.length)))

    /*  the column widths, distributing the remaining width onto the first columns  */
    const cols    = gridColumns(width)
    const free    = width - 4 - (cols - 1) * GRID_GAP
    const widths  = Array.from({ length: cols }, (_x, i) => Math.floor(free / cols) + (i < free % cols ? 1 : 0))

    /*  determine the visible rows by their actual heights, keeping the row of
        the selected card visible and, if not all rows fit, reserving one line
        for the indicator of the hidden cards  */
    const labels  = cards.map((c, i) => cardLines(ctx, c, widths[i % cols]))
    const total   = Math.ceil(cards.length / cols)
    const heights = Array.from({ length: total }, (_x, r) =>
        Math.max(...labels.slice(r * cols, (r + 1) * cols).map((lines) => lines.length + 2)))
    const sum     = (a: number, b: number) => heights.slice(a, b).reduce((n, x) => n + x, 0)
    const room    = height - 3
    const idx     = Math.floor(Math.max(0, cards.findIndex((c) => c.id === sel.id)) / cols)
    let   start   = 0
    let   end     = total
    if (sum(0, total) > room) {
        end = 0
        while (end < total && sum(0, end + 1) <= room - 1)
            end++
        if (idx >= end) {
            start = idx
            end   = idx + 1
            while (start > 0 && sum(start - 1, end) <= room - 1)
                start--
        }
    }
    const above   = start * cols
    const below   = Math.max(0, cards.length - end * cols)
    const items   = heights.slice(start, end).map((rows, i) => {
        const r = start + i
        return h(Box, { key: `row${r}`, height: rows, columnGap: GRID_GAP, paddingX: 1 },
            ...cards.slice(r * cols, (r + 1) * cols).map((c, k) =>
                renderCard(ctx, lane, c, labels[r * cols + k], widths[k], rows, "none", false, false)))
    })

    /*  the centered indicator of the hidden cards, pushed to the bottom of the lane by a growing spacer  */
    if (above > 0 || below > 0)
        items.push(h(Box, { key: "spacer", flexGrow: 1 }),
            h(Box, { key: "more", justifyContent: "center" },
                h(Text, cx("dim", dim && "dimmed"),
                    [ ...(above > 0 ? [ `△ ${above}` ] : []), ...(below > 0 ? [ `▽ ${below}` ] : []) ].join(" "))))
    return h(Box, {
        key: lane.status, ref: ctx.laneRef(g, l), borderStyle: style, borderColor: palette.signal, borderDimColor: dim,
        width, height, flexDirection: "column"
    }, head, ...items)
}

/*  render one group column of the lane view  */
const renderGroup = (ctx: ViewCtx, group: GroupSpec, g: number, width: number, height: number, last: boolean) => {
    const { board, surface, sel, dim } = ctx
    const gap = last ? 0 : GROUP_GAP
    if (surface.collapsed.includes(group.title)) {
        /*  render each lane of the collapsed group as a narrow column with
            its vertically written status and number of cards  */
        const heights = splitHeight(height - 1, group.lanes.map((l) => l.weight), 3)
        const label   = "▶"
        const rest    = Math.max(0, width - label.length)
        const left    = Math.floor(rest / 2)
        return h(Box, { key: group.title, ref: ctx.groupRef(g), flexDirection: "column", width, marginRight: gap },
            h(Text, cx("group-head", sel.g === g && "group-head-selected", dim && "dimmed"),
                " ".repeat(left) + label + " ".repeat(rest - left)),
            ...group.lanes.map((lane, l) => {
                const count = board.lanes.get(lane.status)?.length ?? 0
                const picked = sel.g === g && sel.l === l
                const color  = lane.active ? palette.accent : lane.kind === "terminal" ? palette.dim : palette.normal
                const digits = [ ...String(count) ]

                /*  the title fits between the arrow and the count, each separated
                    by a blank line (inside the two border lines), and is cut with an ellipsis  */
                const room   = Math.max(0, heights[l] - 2 - 1 - 1 - 1 - digits.length)
                let title    = [ ...lane.status.toUpperCase() ]
                if (title.length > room)
                    title = room > 0 ? [ ...title.slice(0, room - 1), "…" ] : []

                /*  the selection marks only the border (signal-colored and bold), not the text  */
                const frame  = {
                    borderStyle: lane.dashed ? (picked ? dashedBold : dashed) : (picked ? "bold" : "round"),
                    borderColor: picked ? palette.signal : color, borderDimColor: dim,
                    height: heights[l], flexDirection: "column", alignItems: "center", overflow: "hidden"
                } as const

                /*  the characters must not shrink, so a too long label is cut  */
                const char   = (key: string, ch: string, bold: boolean) =>
                    h(Box, { key, flexShrink: 0 }, h(Text, { color, bold, dimColor: dim }, ch))

                /*  the unbordered wrapper allows the scroll arrows to escape the clipping,
                    the growing spacer pushes the count to the bottom  */
                return h(Box, { key: lane.status, ref: ctx.laneRef(g, l), height: heights[l], flexDirection: "column" },
                    h(Box, frame,
                        char("arrow", "▶", false),
                        h(Box, { height: 1, flexShrink: 0 }),
                        ...title.map((ch, i) => char(`t${i}`, ch, ch !== "…")),
                        h(Box, { flexGrow: 1, minHeight: 1 }),
                        h(Box, { flexDirection: "column", alignItems: "center", flexShrink: 0 },
                            ...digits.map((ch, i) => char(`c${i}`, ch, false)))),
                    ...scrollArrows(ctx, g, heights[l], true))
            }))
    }
    const min     = group.lanes.map((l) => surface.minimized.includes(l.status))
    const free    = height - 1 - min.filter((m) => m).length * 3
    const heights = splitHeight(free, group.lanes.map((l, i) => min[i] ? 0 : l.weight), 3)
    const label   = ` ▼ ${group.title} `
    const rest    = Math.max(0, width - label.length)
    const left    = Math.floor(rest / 2)
    return h(Box, { key: group.title, ref: ctx.groupRef(g), flexDirection: "column", width, marginRight: gap },
        h(Text, cx("group-head", sel.g === g && "group-head-selected", dim && "dimmed"),
            " ".repeat(left) + label + " ".repeat(rest - left)),
        ...group.lanes.map((lane, l) => renderLane(ctx, lane, g, l, width, heights[l])))
}

/*  render the lane view  */
export const renderLanes = (ctx: BoardCtx) => {
    const { board, surface, sel, dim, carry, fit, columns, boardH, mouse, pulse, grown, cardRef, laneRef, groupRef } = ctx
    const total  = board.groups.length
    const shown  = fit.last - fit.first + 1
    const arrows = shown < total && !grown
    const group  = board.groups[sel.g]
    const info   = grown ? `lane ${group.lanes[sel.l].status} of group ${group.title} grown · g shrinks` :
        `groups ${fit.first + 1}–${fit.last + 1} of ${total} · ${arrows ? "←/→ scrolls" : "all visible"}`
    const view   = { board, surface, sel, dim, carry, titles: surface.titles, scroll: { left: -1, right: -1 }, pulse, cardRef, laneRef, groupRef }

    /*  the scroll bar consumes the entire width remaining besides the info  */
    const track  = Math.max(1, columns - 2 - info.length - 3)
    const on     = Math.max(1, Math.round(track * shown / total))
    const off    = Math.round(track * fit.first / total)
    const minned = surface.minimized.includes(board.groups[sel.g]?.lanes[sel.l]?.status ?? "")
    const folded = surface.collapsed.includes(board.groups[sel.g]?.title ?? "")
    const edges  = { left: fit.first > 0 ? fit.first : -1, right: fit.last < total - 1 ? fit.last : -1 }
    return [
        h(Box, { key: "board", height: boardH, paddingX: 1 },
            ...(grown ? [ renderGrown(view, group.lanes[sel.l], sel.g, sel.l, columns - 2, boardH) ] :
                board.groups.slice(fit.first, fit.last + 1).map((g, i) => renderGroup({ ...view, scroll: edges }, g, fit.first + i, fit.widths[i], boardH, i === fit.widths.length - 1)))),
        h(Box, { key: "bar", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                (arrows ? "░".repeat(off) + "█".repeat(on) + "░".repeat(Math.max(0, track - off - on)) + " · " : "") + info)),
        h(Box, { key: "keys1", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                grown ?
                    "↑/↓/←/→: select task · ⇈/⇊/⇤/⇥: page/first/last task · ⏎: view task · e: edit task · SPACE: start transition task · T: transition task" :
                    "↑/↓/←/→: select task · ⇈/⇊/⇤/⇥: select lane · ⏎: view task · e: edit task · SPACE: start/stop transition task · T: transition task")),
        h(Box, { key: "keys2", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                "D: delete task · N: new task · " +
                (grown ? "g/ESC: shrink lane · " :
                    `m: ${minned ? "maximize" : "minimize"} lane · g: grow lane · c: ${folded ? "expand" : "collapse"} group · `) +
                `t: ${surface.titles ? "collapse" : "expand"} titles · ` +
                "/: filter tasks · v: view graph")),
        h(Box, { key: "keys3", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                `Left-Click: view task / ${grown ? "shrink lane" : "minimize/maximize lane / collapse/expand group"} · ` +
                `M: ${mouse ? "disable" : "enable"} mouse · ?: hide key hints · q: quit`))
    ]
}

/*  render the graph view  */
export const renderGraph = (ctx: BoardCtx) => {
    const { board, sel, dim, layout, boardH, x, y, viewH, viewW, graphView, graphTitles, surface, mouse, pulse } = ctx
    const card = sel.id !== "" ? board.cards.get(sel.id) : undefined
    if (layout === null)
        return [ h(Box, { key: "graph", height: boardH, marginX: 1, paddingX: 1, ...cx("frame", "border-dim") },
            h(Text, cx("dim"), board.cards.size === 0 ? "(no tasks)" : "laying out …")),
        h(Text, { key: "info" }, " "), h(Text, { key: "keys1" }, " "), h(Text, { key: "keys2" }, " "), h(Text, { key: "keys3" }, " ") ]

    /*  draw the ELK layout, with the active nodes pulsing  */
    const { lines, tones } = drawGraphText(layout.board, layout.graph, sel.id, layout.titles, pulse >= 0 ? pulseFrames[pulse] : "")
    const visible = lines.slice(y, y + viewH).map((l, i) => {
        const segs = [] as { text: string, tone: string }[]
        for (let k = x; k < Math.min(l.length, x + viewW); k++) {
            const tone = tones[y + i][k]
            if (segs.length > 0 && segs[segs.length - 1].tone === tone)
                segs[segs.length - 1].text += l[k]
            else
                segs.push({ text: l[k], tone })
        }
        return segs
    })
    const edges   = [ ...board.pred.values() ].reduce((n, ps) => n + ps.length, 0)
    const roots   = [ ...board.cards.keys() ].filter((id) => (board.pred.get(id) ?? []).length === 0).length
    return [
        h(Box, { key: "graph", height: boardH, marginX: 1 },
            /*  a graph smaller than the viewport is centered in it  */
            h(Box, { paddingX: 1, justifyContent: "center", alignItems: "center", ...cx("grow", "column", "frame", "border-dim", dim && "border-dimmed") },
                h(Box, { ref: graphView, ...cx("column") },
                    ...visible.map((segs, i) => h(Box, { key: i },
                        ...(segs.length === 0 ? [ h(Text, { key: 0 }, " ") ] : segs.map((seg, k) => {
                            const tone = `tone-${seg.tone}`
                            return h(Text, { key: k, ...cx(dim && "dimmed", isClass(tone) && tone) }, seg.text)
                        })))))),

            /*  overlay the graph statistics onto the top-right corner of the border  */
            h(Box, { position: "absolute", top: 0, right: 2 },
                h(Text, cx("dim", dim && "dimmed"),
                    ` ${board.cards.size} nodes, ${edges} edges, ${roots} roots${board.cyclic.size > 0 ? ", CYCLES" : ""} `))),
        h(Box, { key: "info", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"), card === undefined ? " " :
                [ "task: ", h(Text, { key: "id", ...cx("bold") }, card.id), " · status: ", h(Text, { key: "status", ...cx("bold") }, card.status) ])),
        h(Box, { key: "keys1", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                "↑/↓/←/→: select task · ⏎/Left-Click: view task · e: edit task · T: transition task")),
        h(Box, { key: "keys2", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                `D: delete task · N: new task · t: ${graphTitles ? "collapse" : "expand"} titles · ` +
                `s: ${surface.standalone ? "hide" : "show"} standalone tasks · ` +
                "/: filter tasks · v: view lanes")),
        h(Box, { key: "keys3", ...cx("bar") },
            h(Text, cx("hint", dim && "dimmed"),
                `M: ${mouse ? "disable" : "enable"} mouse · ?: hide key hints · q: quit`))
    ]
}

