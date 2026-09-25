# Mock AWS fixture

Deterministic local stand-in for the AWS DynamoDB console flow. Used by the
extension (manual/browser verification) and mirrored by
`agent/src/fakes/fake-browser.ts` for the model-free demo.

## Run

```sh
node fixtures/mock-aws/serve.mjs        # http://127.0.0.1:4173
```

## Flow

```text
/                          DynamoDB home, "No tables", button "Create table"
/create-table.html         form: Table name, Partition key, Partition key type (select),
                           buttons "Cancel" and "Create table"
/created.html?name=...     banner "Table created successfully", row with table name + "Active"
```

## Element contract (keep fakes in sync)

| Page | Role | Accessible name | Notes |
|---|---|---|---|
| `/` | heading | `DynamoDB` | level 1 |
| `/` | button | `Create table` | navigates to the form |
| `/` | table | `Tables` | header Name / Status / Partition key, body `No tables` |
| `/create-table.html` | heading | `Create table` | level 1 |
| `/create-table.html` | textbox | `Table name` | required input |
| `/create-table.html` | textbox | `Partition key` | input |
| `/create-table.html` | combobox | `Partition key type` | options `String` (selected), `Number`, `Binary` |
| `/create-table.html` | button | `Cancel` | returns to `/` |
| `/create-table.html` | button | `Create table` | submit; navigate to created page |
| `/created.html` | heading | `Tables` | level 1 |
| `/created.html` | status | `Table created successfully` | banner |
| `/created.html` | link | table name (`remora-demo`) | in table row |
| `/created.html` | cell | `Active` | table status |

The approval rule for the DynamoDB plan matches a click on button `Create table`
while the URL contains `create-table` — the only `mutate` action in the flow.
