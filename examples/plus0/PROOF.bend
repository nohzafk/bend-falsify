import Base
import ./LAWS.bend as Laws
import ./core.bend as C

# The head of this file -- the imports above, and any def above the first
# "# ---- ... ----" header -- is kept in every mutant run.

# ---- tools: the facts about Nat.add and Nat.cmp the proofs here rewrite with ----
#
# Base states no fact about Nat.add, so it is proved here, by induction on
# the first argument; Base states none about Nat.cmp either, and a law whose
# claim is a Bool needs one. A header whose name contains "tools" is kept in
# every mutant run, whatever law is being checked.

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def cmp_refl_r(a: Nat) -> {EQ{} == Nat.cmp(a, a) : Cmp}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %cmp_refl_r(p) : {EQ{} == _ : Cmp}
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

# ---- the two spellings agree ----

# An annotation is the goal as it stands, already reduced: the claim's
# `Nat.is_eq(a, b)` is `Cmp.is_eq(Nat.cmp(a, b))`, so that is what a rewrite
# line spells. Each line removes one spelling of adding nothing.

def Laws.plus0_agree(n):
  %Equal.sym(Nat, Nat.add(n, 0n), n, add_zero(n)) : {Cmp.is_eq(Nat.cmp(Nat.add(n, 0n), _)) == True{} : Bool}
  %Equal.sym(Nat, Nat.add(n, 0n), n, add_zero(n)) : {Cmp.is_eq(Nat.cmp(_, n)) == True{} : Bool}
  %cmp_refl_r(n) : {Cmp.is_eq(_) == True{} : Bool}
  {==}
