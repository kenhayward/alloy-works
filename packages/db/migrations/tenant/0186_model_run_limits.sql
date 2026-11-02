-- How many model turns and tool calls an assistant run on an endpoint may make (issue #872): its own
-- where set, else the default (the domain's `MODEL_TURNS`, `MODEL_TOOL_CALLS`) where null.

alter table model_endpoint
  add column turns_per_run integer check (turns_per_run between 1 and 100),
  add column tool_calls_per_run integer check (tool_calls_per_run between 1 and 500);
