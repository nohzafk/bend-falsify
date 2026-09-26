import Base
import ./core.bend as Core

# The core under an alias other than C. Every statement here says `Core.`, and
# the tool builds an `at` instance out of one of them as written.
law plus0_same:
  for n: Nat
  {Core.plus0(n) == n : Nat}
