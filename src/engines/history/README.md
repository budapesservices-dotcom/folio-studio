# History Engine — planned extraction

The first-stage editor currently implements a bounded 60-snapshot undo/redo reducer in `src/app/editorReducer.ts`. This module is reserved for a future command-based history engine with batching, transactions and memory-efficient inverse operations.
