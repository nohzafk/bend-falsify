import Base
import ./LAWS.bend as Laws
import ./core.bend as Core

# ---- tools: the fact about Nat.add this proof rewrites with ----

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

# ---- plus0 adds nothing ----

def Laws.plus0_same(n):
  %add_zero(n) : {Nat.add(n, 0n) == _ : Nat}
  {==}
