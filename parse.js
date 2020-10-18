//    NodecppParser
//    Author:       ForkKILLET
//
//    TokenPrefix:
//    _t_       type
//    _w_       wrapper
//     f_       function
//     k_       key
//     c_       code
//     i_       index

// :: Import

const {
    Is, ski,
    Logger
}       = require("fkutil")

const {
    log: Log, debug: Debug, err: Err,
    hili: Hili, code: Code
} = Logger({
    debug: true,
    dirObj: true
})

// :: Main

const N = {
  Syn: [
    "Block",
    "Line",
    "LineContinue",
  ],
  Block: {
    Blank:  /^[ \t\n\r]+/,
    Number: /^((0x|0|0b)?\d+|\d+[Ee]-?\d+|\d+\.\d+)/, // TODO: postfix
    Symbol: /^[+\-*/%&|!~^=<>.#:?,;'"`]+/,
    Pair:   /^[()[\]{}]/,
    Token:  /^[_a-zA-Z][_a-zA-Z0-9]*/
  },
  Node: {
    Number: {
      flag: "Number",
      end: "Block"
    },
    LineComment: {
      flag: "Symbol",
      begin: /\/{2}/,
      end: "LineContinue",
      
      value: {
        SlashNum: c => c.match(/^\/+/)[0].length
      }
    },
    BlockComment: {
      flag: "Symbol",
      begin: /\/\*/,
      end: /\*\//
    },
    SQString: {
      flag: "Symbol",
      begin: /'/,
      end: /(?<!\\)(\\{2})*'/
    },
    DQString: {
      flag: "Symbol",
      begin: /"/,
      end: /(?<!\\)(\\{2})*"/
    },
    ABString: {
      flag: "Symbol",
      begin: /</,
      end: />/
    },
    HashCommand: {
      flag: "Symbol",
      begin: /#/,
      end: "LineContinue",

      zone: {
        HashCommand: {
          flag: "Curr",
          then: { name: "Command" }
        },
        Command: {
          flag: "Token",
          asValue: "Command",
          then: { value: "Command", caps: true }
        },
        Include: {
          flag: "Follow",
          then: [
            { name: "StdHeader" },
            { name: "UserHeader" }
          ]
        },
        StdHeader: {
          blank: true,
          extend: "ABString",
          then: null
        },
        UserHeader: {
          blank: true,
          extend: "DQString",
          then: null
        }
      }
    }
  }
}

function indentMark(d) {
    return "\x1B[36m+--" + "----".repeat(d) + " \x1B[0m"
}

class _t_parser {
    constructor ({ whoami } = {}) {
        this.whoami = whoami ?? "NodecppParser"
    }

    err(info) {
        info._from = this.whoami
        info._group = ski(info.what.match(/^(.) /)?.[1] ?? ".", {
            ".": "normal",
            "*": "inside",
            "%": "config",
            "!": "assert",
            "#": "signal"
        })
        info._what = info.what.replace(/^(.) /, "")
        delete info.what
        throw info
    }
    errIs(e, info) {
        return ! (
            Is.empty(e) ||
            ! Is.objR(info) ||
            this.whoami !== e?._from ||
            Is.str(info.group) && info.group !== e?._group ||
            Is.str(info.what) && info.what !== e?._what
        )
    }

    c_from(i) {
        return this.code.substring(i)
    }

    c_to(i) {
        return this.code.substring(this.index, i)
    }

    get c_follow() {
        return this.c_from(this.index)
    }

    next(n, ...p) {
        if (N.Syn.includes(n)) return this["next_" + n](...p)
        this.err({
            what: "* NextUnknown", next: n
        })
    }

    next_Block(force) {
        if (this.blockCurr && ! force) return this.blockCurr

        const c = this.c_follow
        let rs, i; for (i in N.Block)
            if (rs = c.match(N.Block[i])) break
        if (! rs) this.err({
            what: "BlockIllegal", code: c
        })

        this.index += rs[0].length

        const that = this; return this.blockCurr = {
            type: i,
            code: rs[0],
            offset: rs[0].length,
            assert(t) {
                if (i !== t) throw that.err({
                    what: "! BlockType",
                    assert: t, exact: i, code: c
                })
                return this
            }
        }
    }

    next_Line() {
        return {
            offset: this.c_follow.indexOf("\n")
        }
    }

    next_LineContinue() {
        const c = this.c_follow
        const rs = c.match(/^([^\n]+\\\n)*[^\n]+(?=\n)/)
        return {
            offset: rs[0].length,
            lines: rs[0].split("\\\n").map(i => i + "\n")
        }
    }

    get finish() {
        return this.index >= this.code.length
    }

    addNode(node, pa = this.astPa) {
        if (! Is.arr(pa)) this.err({
            what: "* AstParentIllegal", parent: pa
        })
        pa.push(node)
    }

    matchNode({ n, f }) {
        let l, b
        const i_o = this.index, c = this.c_follow
        const ret = (
            n.flag === this.next_Block(f).type && (
            Is.udf(n.begin) ||
            Is.re(n.begin) && (b = c.match(n.begin))?.index === 0
        ) && (l = ski.type(n.end, {
                regexp: e => {
                    const rs = e.exec(c.substring(b.length))
                    if (rs) return rs.index + rs[0].length + b.length
                },
                string: e => this.next(e)?.offset
            })?.(n.end)
        )) ? { offset: l } : null
        this.index = i_o
        return ret
    }

    procNode({ k_n, n, i_o, f, d }) {
        if (this.requireBlank) {
            if (this.requireBlank = this.next_Block(true).type !== "Blank") return
        }
        else this.index = i_o

        const l = this.matchNode({ n, f })?.offset
        if (Is.empty(l)) return

        const i_e = this.index + l, c_n = this.c_to(i_e)
        Debug(indentMark(d) + `Match Node: ${Hili(k_n)}. Code:\n`
            + Code(c_n).indent(d + 1))

        const value = {}
        if (n.value) for (let [ k_v, f_v ] of Object.entries(n.value))
            value[k_v] = f_v(c_n)

        const zone = {}
        if (n.zone) {
            const f_z = (k_z, i_z) => {
                this.index = i_z

                const z = n.zone[k_z]
                if (Is.empty(z)) this.err({
                    what: "% NodeZoneMissing",
                    node: k_n, zone: k_z, init: k_z === k_n
                })

                let c_z
                if (z.blank) this.requireBlank = true
                if (z.extend) {
                    c_z = this.procNode({
                        k_n: z.extend, n: N.Node[z.extend], i_o: i_z,
                        f: true, d: d + 1
                    })?.Code
                    if (Is.udf(c_z)) this.err({
                        what: "# NodeZoneThenInvalid"
                    })
                }
                else c_z = ski(z.flag, {
                    Curr: () => {
                        this.index += this.blockCurr.offset
                        return this.blockCurr.code
                    },
                    Follow: () => this.c_to(i_e)
                }, () => {
                    if (Object.keys(N.Block).includes(z.flag))
                        return this.next_Block(true).assert(z.flag).code
                    this.err({
                        what: "% NodeZoneFlagUnknown",
                        node: k_n, zone: k_z, flag: z.flag
                    })
                })()

                Debug(indentMark(d + 1) + `Match Zone: ${Hili(k_z)}. Code:\n` +
                    (Code(c_z)).indent(d + 2))

                zone[k_z] = { Type: k_z, Code: c_z }
                if (Is.str(z.asValue)) value[z.asValue] = c_z

                if (Is.nul(z.then)) return
                const then = Array.fromElementOrArray(z.then), i_t = this.index
                for (let t of then) {
                    let n
                    if (t.name)     n = t.name
                    if (t.value)    n = value[t.value]
                    if (t.caps)     n = n[0].toUpperCase() + n.substring(1)

                    try { return f_z(n, i_t) }   
                    catch (e) {
                        if (this.errIs(e,
                            { group: "signal", what: "NodeZoneThenInvalid" })) ;
                        else throw e
                    }          
                }
            }
            f_z(k_n, this.index)
        }

        if (!Is.objE(value)) Debug("Value: ".indent(d + 1) + "%o", value)
        
        this.index = i_e + 1

        return {
            Type: k_n,
            From: i_o, To: i_o + l,
            Code: c_n,
            ...value,
            Zones: n.zone ? zone : null
        }
    }

    parse(code, opt) {
        this.code           = code.endWith("\n") ? code : code + "\n"
        this.opt            = opt
        this.index          = 0
        this.blockCurr      = null
        this.requireBlank   = false
        this.ast            = []
        this.astPa          = this.ast

        while (! this.finish) {
            const i_o = this.index, b = this.next_Block(true), i_e = this.index

            Debug((`Match Block, type ${Hili(b.type)}.` +
                (b.type === "Blank" ? "" : " Code: " + Code(b.code))).indent(1))
            if (b.type === "Blank") continue

            let nAst; for (let [ k_n, n ] of Object.entries(N.Node))
                if (nAst = this.procNode({ k_n, n, i_o, d: 0 })) {
                    this.addNode(nAst); break
                }
            if (Is.udf(nAst)) this.index = i_e
        }
        return this.ast
    }
}

const parser = new _t_parser()

module.exports = parser

// :: Debug

Debug(parser.parse(`
// :: Info
//    P1001 A+B\\
      problem
      
#include <cstdio>
#include "header.h"

/**
 * @function:   main
 * @brief:      entrance
 */

int main() {
    int a, b;
    scanf("%d%d", &a, &b);
    printf("%d", a + b);
    return 0;
}
`))


