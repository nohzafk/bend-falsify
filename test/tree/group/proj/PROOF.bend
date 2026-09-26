import Base
import ./LAWS.bend as Laws
import ./core.bend as C
import ../../lib/facts.bend as F

# ---- double adds ----

def Laws.double_adds(n):
  {==}

# ---- keep is the identity ----

def Laws.keep_same(n):
  Equal.sym(Nat, n, Nat.add(n, 0n), F.add_zero_r(n))
