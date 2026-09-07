#!/usr/bin/env node
import { DatabaseClient } from "./client.js";
import { ContextPaths } from "../paths.js";

const paths = ContextPaths.resolve();
DatabaseClient.migrate(paths.sqlitePath).close();
process.stderr.write(`Migrated ${paths.sqlitePath}\n`);
