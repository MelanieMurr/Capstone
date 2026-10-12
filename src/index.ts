import { Effect, Console } from "effect"

const program = Console.log("Hello, World!")

const result = Effect.runSync(program)