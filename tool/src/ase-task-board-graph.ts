/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js"

import { toneOf, byCreation, cardLabel, clampLines, glueId, glueTitle } from "./ase-task-board-core.js"
import type { Board }                                                     from "./ase-task-board-core.js"

/*  a laid out node box, a laid out edge, and the whole layout  */
export type GraphBox    = { id: string, x: number, y: number, w: number, h: number }
export type GraphPoint  = { x: number, y: number }
export type GraphEdge   = { from: string, to: string, points: GraphPoint[] }
export type GraphLayout = { width: number, height: number, nodes: Map<string, GraphBox>, edges: GraphEdge[] }

/*  the unit systems a layout is computed in: terminal character cells
    (width in columns, height in rows) or browser pixels, with the height of
    a single-line node, the height of each additional label line, and (in
    pixel units) the estimated characters per label line of the fixed-width node  */
const units = {
    cell: { w: (label: string) => label.length + 4, h: 3,  line: 1,    chars: 0,  nodeNode: 1,  layers: 8,  edgeEdge: 1,  edgeNode: 1 },
    px:   { w: () => 260,                            h: 36, line: 18.2, chars: 34, nodeNode: 18, layers: 64, edgeEdge: 10, edgeNode: 14 }
}

/*  the label lines of a node (in cell units only) of a given box width: the
    task id and title, cut onto a single line, or with titles shown, wrapped
    onto at most three lines, with a placeholder column glued in front of
    the task id to reserve the extra column of its inverse rendering, and
    the arrow in front of the title replaced by a placeholder column glued to the title  */
export const nodeLines = (board: Board, id: string, titles: boolean, width: number): string[] =>
    clampLines(glueId + cardLabel(board.cards.get(id)!).replace(`${id} ▶ `, `${id} ${glueTitle}`), width - 4, titles ? 3 : 1)

/*  lay out the dependency graph with ELK Layered: left to right, orthogonal
    edge routing, every edge leaving its source on the east side and entering
    its target on the west side; "elkjs" is loaded on demand only, as it is
    large and needed by the graph view alone; in cell units, all nodes have
    the same given width and can optionally be enlarged to wrap the task
    titles onto more lines  */
export const layoutGraph = async (board: Board, unit: "cell" | "px", titles = false, width = 40): Promise<GraphLayout> => {
    const u    = units[unit]
    const linked = (id: string) => (board.pred.get(id) ?? []).length + (board.succ.get(id) ?? []).length > 0 ? 0 : 1
    const ids  = [ ...board.cards.values() ].sort((a, b) => linked(a.id) - linked(b.id) || byCreation(a, b)).map((c) => c.id)
    const port = { width: 0, height: 0 }
    const graph: ElkNode = {
        id: "root",
        layoutOptions: {
            "elk.algorithm":                                    "layered",
            "elk.direction":                                    "RIGHT",
            "elk.edgeRouting":                                  "ORTHOGONAL",
            "elk.padding":                                      "[top=0,left=0,bottom=0,right=0]",
            "elk.spacing.nodeNode":                             String(u.nodeNode),
            "elk.spacing.edgeEdge":                             String(u.edgeEdge),
            "elk.spacing.edgeNode":                             String(u.edgeNode),
            "elk.spacing.componentComponent":                   String(u.nodeNode),
            "elk.layered.spacing.nodeNodeBetweenLayers":        String(u.layers),
            "elk.layered.spacing.edgeNodeBetweenLayers":        String(u.edgeNode),
            "elk.layered.spacing.edgeEdgeBetweenLayers":        String(u.edgeEdge),
            "elk.layered.mergeEdges":                           "false",
            "elk.layered.considerModelOrder.components":        "MODEL_ORDER",
            "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
            "elk.layered.nodePlacement.strategy":               "NETWORK_SIMPLEX"
        },
        children: ids.map((id) => {
            /*  in cell units, a node holds its label lines, in pixel units its
                estimated label lines (as wrapped by the browser within the card)  */
            const lines = unit === "cell" ? nodeLines(board, id, titles, width) :
                clampLines(cardLabel(board.cards.get(id)!), u.chars, titles ? 3 : 1)
            const w     = unit === "cell" ? width : u.w(id)
            const h     = Math.round(u.h + (lines.length - 1) * u.line)

            /*  the ports stay at the first label line (the middle of a single-line node)  */
            const y     = Math.floor(u.h / 2)
            return {
                id, width: w, height: h,
                layoutOptions: { "elk.portConstraints": "FIXED_POS" },
                ports: [
                    { id: `${id}:in`,  x: 0, y, ...port },
                    { id: `${id}:out`, x: w, y, ...port }
                ]
            }
        }),
        edges: ids.flatMap((id) => (board.pred.get(id) ?? []).map((p): ElkExtendedEdge =>
            ({ id: `${p}->${id}`, sources: [ `${p}:out` ], targets: [ `${id}:in` ] })))
    }
    const ELK   = (await import("elkjs/lib/elk.bundled.js")).default.default
    const res   = await new ELK().layout(graph)
    const round = (v: number | undefined) => Math.round(v ?? 0)
    const nodes = new Map<string, GraphBox>()
    for (const n of res.children ?? [])
        nodes.set(n.id, { id: n.id, x: round(n.x), y: round(n.y), w: round(n.width), h: round(n.height) })
    const edges = (res.edges ?? []).map((e) => {
        const [ from, to ] = e.id.split("->")
        const points = (e.sections ?? []).flatMap((s) =>
            [ s.startPoint, ...(s.bendPoints ?? []), s.endPoint ].map((p) => ({ x: round(p.x), y: round(p.y) })))
        return { from, to, points }
    })
    return { width: round(res.width), height: round(res.height), nodes, edges }
}

/*  the box drawing character of a set of line directions  */
const UP    = 1
const DOWN  = 2
const LEFT  = 4
const RIGHT = 8
const junction: Record<number, string> = {
    [LEFT]: "─", [RIGHT]: "─", [LEFT | RIGHT]: "─", [UP]: "│", [DOWN]: "│", [UP | DOWN]: "│",
    [DOWN | RIGHT]: "┌", [DOWN | LEFT]: "┐", [UP | RIGHT]: "└", [UP | LEFT]: "┘",
    [UP | DOWN | RIGHT]: "├", [UP | DOWN | LEFT]: "┤", [LEFT | RIGHT | DOWN]: "┬",
    [LEFT | RIGHT | UP]: "┴", [UP | DOWN | LEFT | RIGHT]: "┼"
}

/*  draw a cell-unit layout onto a character grid, returning per cell the
    character and a tone for coloring: the node tones "done", "active",
    "idle", and "sel" (selected node) with a "-frame" suffix on the box border,
    an "-id" suffix on the task id, a "-title" suffix on the rest of the label, and
    "edge" or "edge-sel" (an edge touching the selected node), with a given pulse
    glyph (if any) in the top border of the active nodes (like in the lane view)  */
export const drawGraphText = (board: Board, layout: GraphLayout, selected: string, titles = false, pulse = "") => {
    const W     = layout.width + 2
    const H     = layout.height + 1
    const mask  = Array.from({ length: H }, () => new Array<number>(W).fill(0))
    const tones = Array.from({ length: H }, () => new Array<string>(W).fill(""))
    const chars = Array.from({ length: H }, () => new Array<string>(W).fill(" "))

    /*  lines of all edges, where edges of the selected node are marked  */
    for (const e of layout.edges) {
        const tone = e.from === selected || e.to === selected ? "edge-sel" : "edge"
        const set  = (x: number, y: number, bits: number) => {
            if (y < 0 || y >= H || x < 0 || x >= W)
                return
            mask[y][x] |= bits
            if (tones[y][x] !== "edge-sel")
                tones[y][x] = tone
        }
        for (let i = 1; i < e.points.length; i++) {
            const a = e.points[i - 1]
            const b = e.points[i]
            if (a.y === b.y) {
                const [ x0, x1 ] = a.x < b.x ? [ a.x, b.x ] : [ b.x, a.x ]
                for (let x = x0; x <= x1; x++)
                    set(x, a.y, (x > x0 ? LEFT : 0) | (x < x1 ? RIGHT : 0))
            }
            else {
                const [ y0, y1 ] = a.y < b.y ? [ a.y, b.y ] : [ b.y, a.y ]
                for (let y = y0; y <= y1; y++)
                    set(a.x, y, (y > y0 ? UP : 0) | (y < y1 ? DOWN : 0))
            }
        }
    }
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            if (mask[y][x] !== 0)
                chars[y][x] = junction[mask[y][x]] ?? "┼"

    /*  arrow heads in front of the west side of each target  */
    for (const e of layout.edges) {
        const end = e.points[e.points.length - 1]
        if (end !== undefined && end.x - 1 >= 0 && end.y < H)
            chars[end.y][end.x - 1] = "►"
    }

    /*  node boxes on top, where a context node (of a filtered graph) is dimmed and dashed  */
    for (const n of layout.nodes.values()) {
        const ctx   = board.context.has(n.id)
        const base  = ctx ? "done" : toneOf(board, board.cards.get(n.id)!)
        const tone  = n.id === selected ? "sel" : base
        const hor   = ctx ? "╌" : "─"
        const ver   = ctx ? "╎" : "│"
        for (let y = n.y; y < n.y + n.h && y < H; y++)
            for (let x = n.x; x < n.x + n.w && x < W; x++) {
                const top = y === n.y
                const bot = y === n.y + n.h - 1
                const lft = x === n.x
                const rgt = x === n.x + n.w - 1
                chars[y][x] = top ? (lft ? "┌" : rgt ? "┐" : hor) :
                    bot ? (lft ? "└" : rgt ? "┘" : hor) : (lft || rgt ? ver : " ")
                tones[y][x] = top || bot || lft || rgt ? `${tone}-frame` : tone
            }
        if (pulse !== "" && base === "active")
            chars[n.y][n.x + n.w - 3] = pulse

        /*  the label lines, with the task id at the start of the first line
            (behind the placeholder, and with one column of spacing on each side of it)  */
        nodeLines(board, n.id, titles, n.w).forEach((line, k) => {
            const row = n.y + 1 + k
            if (row >= n.y + n.h - 1 || row >= H)
                return
            for (let i = 0; i < line.length && n.x + 2 + i < W; i++) {
                chars[row][n.x + 2 + i] = (k === 0 && i === 0) || line[i] === glueTitle ? " " : line[i]
                tones[row][n.x + 2 + i] = k === 0 && i <= n.id.length + 1 ? `${tone}-id` : `${tone}-title`
            }
            if (k === 0 && n.x + 3 + n.id.length < Math.min(W, n.x + n.w - 1))
                tones[row][n.x + 3 + n.id.length] = `${tone}-id`
        })
    }
    return { lines: chars.map((r) => r.join("")), tones }
}

/*  the box of a graph node on the screen (center row/column and borders)  */
export type Place = { r: number, c: number, top: number, bottom: number, bl: number, br: number }

/*  find the nearest graph node in the direction of an arrow, as the nodes are placed
    on the screen, preferring nodes in the same row (left/right) or column (up/down)  */
export const nearestPlace = (places: Map<string, Place>, from: string, dir: "left" | "right" | "up" | "down"): string | undefined => {
    const cur = places.get(from)
    if (cur === undefined)
        return undefined
    let best = Infinity
    let next: string | undefined
    for (const [ id, p ] of places) {
        const dr = p.r - cur.r
        const dc = p.c - cur.c
        const ok = dir === "right" ? dc > 0 : dir === "left" ? dc < 0 : dir === "down" ? dr > 0 : dr < 0
        if (id === from || !ok)
            continue
        const score = dir === "left" || dir === "right" ?
            Math.abs(dc) + Math.abs(dr) * 4 : Math.abs(dr) + Math.abs(dc) / 4
        if (score < best) {
            best = score
            next = id
        }
    }
    return next
}

/*  escape a text for embedding into SVG  */
const escapeXML = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/*  draw a pixel-unit layout as SVG, with every node a "g.node" carrying
    its "data-id" and tone class (plus "context" for a context node of a filtered graph),
    for the click delegation of the page, and holding the same HTML card
    (task id sub-box and truncated title) as the lanes  */
export const drawGraphSVG = (board: Board, layout: GraphLayout): string => {
    const out   = [ `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" ` +
        `height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    "<defs><marker id=\"arrow\" viewBox=\"0 0 10 10\" refX=\"10\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" " +
        "orient=\"auto-start-reverse\"><path d=\"M0,0 L10,5 L0,10 z\" class=\"arrow\"/></marker></defs>" ]
    for (const e of layout.edges) {
        const d = e.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
        out.push(`<path class="edge" data-from="${escapeXML(e.from)}" data-to="${escapeXML(e.to)}" d="${d}" marker-end="url(#arrow)"/>`)
    }
    for (const n of layout.nodes.values()) {
        const card = board.cards.get(n.id)!
        out.push(`<g class="node tone-${toneOf(board, card)}${board.context.has(card.id) ? " context" : ""}" data-id="${escapeXML(card.id)}">` +
            `<foreignObject x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}">` +
            `<div xmlns="http://www.w3.org/1999/xhtml" class="card"><div class="cbody"><span class="cid">${escapeXML(card.id)}</span>` +
            `${board.cyclic.has(card.id) ? "⟲ " : ""}${escapeXML(card.title)}</div></div></foreignObject></g>`)
    }
    out.push("</svg>")
    return out.join("\n")
}

