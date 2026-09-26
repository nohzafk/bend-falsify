import Base
import ./LAWS.bend as Laws
import ./core.bend as C
import ../../lib/facts.bend as F

# ---- tools: an impossible equation proves anything ----

# `Tag(True{})` is Empty and `Tag(False{})` is Unit, so rewriting the equation's
# right-hand side away lands the goal in Unit. This is what closes a case the
# law's premise rules out: the premise reduces to False{} == True{} there.

def Tag(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def to_empty(e: {False{} == True{} : Bool}) -> Empty:
  %e : Tag(_)
  Unit{}

# ---- double adds ----

def Laws.double_adds(n):
  {==}

# ---- keep is the identity ----

def Laws.keep_same(n):
  Equal.sym(Nat, n, Nat.add(n, 0n), F.add_zero_r(n))

# ---- the file import steps by one ----

def Laws.shift_same(n):
  {==}

# ---- keep2 is the identity while keep is ----

def Laws.keep2_when_keep(n, h):
  Equal.sym(Nat, n, Nat.add(n, 0n), F.add_zero_r(n))

# ---- under the gate, the answer is zero ----

def Laws.answer_zero_under_gate(n, h):
  match n:
    case 0n:
      {==}
    case 1n+p:
      Empty.absurd({C.answer(1n+p) == 0n : Nat}, to_empty(h))
