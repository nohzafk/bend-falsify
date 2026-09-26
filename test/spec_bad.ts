export default { imports: ["./tree/group/proj/core.bend as C"], instances: [
  { name: "good", claim: "{C.double(2n) == 4n : Nat}" },
  { name: "wrong", claim: "{C.double(2n) == 5n : Nat}" },
] };
