export default { imports: ["./tree/group/proj/core.bend as C"], instances: [0, 1, 2, 3].map((n) => ({ name: `d${n}`, claim: `{C.double(${n}n) == ${2 * n}n : Nat}` })) };
