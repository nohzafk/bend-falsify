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

# ---- the file import steps by one ----

def Laws.shift_same(n):
  {==}

# ---- keep2 is the identity while keep is ----

def Laws.keep2_when_keep(n, h):
  Equal.sym(Nat, n, Nat.add(n, 0n), F.add_zero_r(n))
