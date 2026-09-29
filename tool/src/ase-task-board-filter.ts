/*
**  Agentic Software Engineering (ASE)
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import type { Board, Card } from "./ase-task-board-core.js"

/*  shortest keyword still eligible for fuzzy matching: below it the
    edit distance would equate it with almost any short word  */
const fuzzyMin = 4

/*  the Levenshtein edit distance of two words  */
const levenshtein = (a: string, b: string): number => {
    let prev = [] as number[]
    let curr = [] as number[]
    for (let j = 0; j <= b.length; j++)
        prev[j] = j
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++)
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        const swap = prev
        prev = curr
        curr = swap
    }
    return prev[b.length]
}

/*  the Sorensen-Dice bigram similarity coefficient of two words  */
const diceCoefficient = (a: string, b: string): number => {
    if (a === b)
        return 1
    if (a.length < 2 || b.length < 2)
        return 0
    const bigrams = new Map<string, number>()
    for (let i = 0; i < a.length - 1; i++) {
        const bigram = a.substring(i, i + 2)
        bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1)
    }
    let hits = 0
    for (let i = 0; i < b.length - 1; i++) {
        const bigram = b.substring(i, i + 2)
        const count  = bigrams.get(bigram) ?? 0
        if (count > 0) {
            bigrams.set(bigram, count - 1)
            hits++
        }
    }
    return (2 * hits) / (a.length + b.length - 2)
}

/*  parse a filter query into its comma-separated OR-combined parts,
    each a list of whitespace-separated AND-combined keywords  */
export const parseFilter = (query: string): string[][] =>
    query.toLowerCase().split(",")
        .map((part) => part.split(/\s+/).filter((word) => word !== ""))
        .filter((part) => part.length > 0)

/*  determine the ids of the cards matching a filter query (as SpecBook
    does): each part matches in up to two passes, the keywords as literal
    substrings of task id and title first and, only if this matches no card
    at all, as fuzzy variants of their words, as the edit-distance neighborhood
    of a keyword would otherwise dilute a correctly spelled query  */
export const matchCards = (cards: Card[], query: string): Set<string> => {
    const units = cards.map((card) => {
        const text = `${card.id} ${card.title}`.toLowerCase()
        return { id: card.id, text, words: new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "")) }
    })
    const vocab = new Set(units.flatMap((unit) => [ ...unit.words ]))

    /*  the fuzzy-equivalent vocabulary words of a keyword, cached per keyword  */
    const fuzzy = new Map<string, string[]>()
    const fuzzyWords = (word: string): string[] => {
        let result = fuzzy.get(word)
        if (result === undefined) {
            result = word.length < fuzzyMin ? [] : [ ...vocab ].filter((given) =>
                Math.abs(word.length - given.length) <= 1
                && (diceCoefficient(word, given) >= 0.50 || levenshtein(word, given) <= 2))
            fuzzy.set(word, result)
        }
        return result
    }
    const kept = new Set<string>()
    for (const part of parseFilter(query)) {
        let matched = units.filter((unit) => part.every((word) => unit.text.includes(word)))
        if (matched.length === 0)
            matched = units.filter((unit) => part.every((word) =>
                unit.text.includes(word) || fuzzyWords(word).some((v) => unit.words.has(v))))
        matched.forEach((unit) => kept.add(unit.id))
    }
    return kept
}

/*  reduce a board onto the cards matching a filter query (an empty query
    keeps the board as-is), where for the graph the direct predecessors and
    successors of the matching cards are kept as context cards, too  */
export const filterBoard = (board: Board, query: string, graph = false): Board => {
    if (parseFilter(query).length === 0)
        return board
    const matched = matchCards([ ...board.cards.values() ], query)
    const context = new Set<string>()
    if (graph)
        for (const id of matched)
            for (const ref of [ ...(board.pred.get(id) ?? []), ...(board.succ.get(id) ?? []) ])
                if (!matched.has(ref))
                    context.add(ref)
    const kept  = (id: string) => matched.has(id) || context.has(id)
    const edges = (map: Map<string, string[]>) =>
        new Map([ ...map ].filter(([ id ]) => kept(id)).map(([ id, refs ]) => [ id, refs.filter(kept) ]))
    return {
        ...board,
        cards:   new Map([ ...board.cards ].filter(([ id ]) => kept(id))),
        lanes:   new Map([ ...board.lanes ].map(([ status, cards ]) => [ status, cards.filter((c) => kept(c.id)) ])),
        pred:    edges(board.pred),
        succ:    edges(board.succ),
        context
    }
}

/*  reduce a board onto the cards having any predecessors or successors,
    i.e., drop the standalone cards (for the graph only)  */
export const dropStandalone = (board: Board): Board => {
    const kept = (id: string) => (board.pred.get(id) ?? []).length + (board.succ.get(id) ?? []).length > 0
    return {
        ...board,
        cards: new Map([ ...board.cards ].filter(([ id ]) => kept(id))),
        lanes: new Map([ ...board.lanes ].map(([ status, cards ]) => [ status, cards.filter((c) => kept(c.id)) ]))
    }
}

