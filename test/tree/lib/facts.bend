import Base

def add_zero(a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def add_zero_r(a: Nat) -> {a == Nat.add(a, 0n) : Nat}:
  %add_zero(a) : {_ == Nat.add(a, 0n) : Nat}
  {==}
