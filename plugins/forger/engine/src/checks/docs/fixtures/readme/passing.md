# Widget

Widget cuts logs into readable pieces. It is for developers who debug services.

## Install

1. Run `npm install widget@1.2.3`.
2. Add the plugin to your config.

| Field | Meaning |
| --- | --- |
| `size` | A very long description of this field that would be far too long for one sentence in prose but a table is skipped by the rule so it does pass. |

```sh
# 100 files were written by the command, and this line is quoted output that the rule skips because it is inside a code block.
widget run
```

## Use

Widget reads a file. It prints each part. You can pipe the output to another tool.
