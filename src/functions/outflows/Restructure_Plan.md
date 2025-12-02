okay, I want to make this really simple, and i think we are ending up with some spaghetti code.lets do some
  refactoring to simplify this.

  the logical flow is this
  transactions/splits within transactions > outflow > outflow period > user summary / group summary (if it
  exists)

  so each of these should have some fairly simply functions associated
  createOutflow (which should follow all the functions associated with creating an outflow)
  updateOutflow (which should handle whatever update is provided to the outflow. it should be able to handle
  user updates, and updates from the user)
  onOutflowUpdated (it should handle migrating any changes to the outflow periods, including marking them as
  paid. it needs to handle this as a single batch update)
  onOutflowCreated (this needs to handle the creation of all periods and setting them to paid or not paid
  based on the transactions in the outflow) 

  Here is how we need to look at this. This will be the new directory structure

  -outflows
  --admin
  --api
  --dev

  --outflow_periods
  ---crud
  ----createOutflowPeriod.tsx
  ----updateOutflowPeriod.tsx
  ----deleteOutflowPeriod.tsx

  ---triggers
  ----onOutflowPeriodCreate.tsx
  ----onOutflowPeriodUpdate.tsx
  ----onOutflowPeriodDelete.tsx

  ---utils
  ----formatRecurringOutflows.tsx
  ----checkIsDuePeriod.tsx
  ----predictFutureBillDueDate.tsx
  ----batchCreateRecurringStreams.tsx
  ----calculateWitholdingAmount.tsx
  ----calculateAllOccurencesInPeriod.tsx
  ----autoMatchTransactionsToOutflowPeriod.tsx

  --outflow_main
  ---crud
  ----createOutflow.tsx
  ----updateOutflow.tsx
  ----deleteOutflow.tsx
  ---triggers
  ----onOutflowCreated.tsx
  ----onOutflowUpdate.tsx
  ----onOutflowDelete.tsx
  ---utils
  ----formatOutflowPeriod.tsx
  ----batchCreateOutflowPeriods.tsx
 
  --outflow_summaries
  ---crud
  ----updateOutflowSummaries.tsx
  ----createOutflowSummmaries.tsx
  ----deleteOutflowSummaries.tsx
  ---triggers
  ---utils
  
  --types
  ---outflow_type.tsx
  ---outflow_periods_type.tsx
  ---outflow_summaries_type.tsx