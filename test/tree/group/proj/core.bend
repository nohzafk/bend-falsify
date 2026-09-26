import Base
import ./sub/k.bend as K
import ../shared.bend as S

def double(n: Nat) -> Nat:
  Nat.mul(n, K.two())

def keep(n: Nat) -> Nat:
  Nat.add(n, 0n)

def keep2(n: Nat) -> Nat:
  Nat.add(n, 0n)

# The step lives in a file one directory up, imported by name.
def shift(n: Nat) -> Nat:
  S.bump(n)

# A gate that admits 0n and nothing else, and an answer of its own for each
# shape. The law below states the answer under the gate, so the gate is the
# line a premise-relaxing mutant moves.
def gate(n: Nat) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+p:
      False{}

def answer(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      1n
