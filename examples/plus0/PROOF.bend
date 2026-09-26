import Base
import ./LAWS.bend as Laws
import ./core.bend as C

# The head of this file -- the imports above, and any def above the first
# "# ---- ... ----" header -- is kept in every mutant run.

# ---- tools: the one fact about Nat.add the proofs here rewrite with ----
#
# Base states no fact about Nat.add, so it is proved here, by induction on
# the first argument. A header whose name contains "tools" is kept in every
# mutant run, whatever law is being checked.

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

# ---- the other spelling adds nothing ----

def Laws.plus0_slow_same(n):
  %add_zero(n) : {Nat.add(n, 0n) == _ : Nat}
  {==}

# ---- twice is the same ----

def Laws.plus0_twice_same(n):
  %Equal.sym(Nat, Nat.add(n, 0n), n, Laws.plus0_same(n)) : {Nat.add(_, 0n) == n : Nat}
  %Equal.sym(Nat, Nat.add(n, 0n), n, Laws.plus0_same(n)) : {_ == n : Nat}
  {==}
