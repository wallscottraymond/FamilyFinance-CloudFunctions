okay, I want to make this really simple, and i think we are ending up with some spaghetti code.lets do some
  refactoring to simplify this.

  the logical flow is this
  transactions/splits within transactions > outflow > outflow period > user summary / group summary (if it
  exists)

  ###IMPORTANT

  A large number of these functions exist already, this is more about organizing what is there, and filling in what is not. before you do anything you need to evaluate each step and ensure that each step either exists or needs to be created. The existing files are called out below in terms of where they SHOULD be, but there are a large amount of files already in the outflow directory. and this represents a change to how we are building today.

  ####Overview of Restructure
  The goal here is to simplify the flow through the system, and ensure there are no crisscrossing layers. For example, a change to a single layer will feed to the next.

  Outflow (the source data object that is created from plaid)
  Outflow Period (these are the calculation periods that hold the detailed items related to the outflow for that particular source period)
  Outflow Summary (this is the view layer for the user. Summaries are grouped by period, so there will be a single summary period for e.g., 2025M11 that will hold summary data, inflow, budget, outflow, and goal information. The functions within this section of the refactor will be responsible for creating, updating, and modifying information in this specic section of the app.)

  createOutflow.tsx - hen data comes in from Plaid, or when a user creates an outflow, the function that should be called is createOutflow. There are various formatting and calculations contained within that, but they should all be contained in a single "createOutflow" function.

  onOutflowCreate should called createOutflowPeriods

  Here is how we need to look at this. This is just a thought exercise on the new directory structure. I'll outline how it needs to function in the steps below.

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


Below are the steps I'd like to take for this refactoring

  ####Step 1
  change the directory structure for the outflows section to be structured as I have it above. 
  outflows (root directory)
  -outflowPeriods
  --api
  --dev
  --types
  ---outflow_periods_type.tsx
  --crud
  ----onOutflowCreated.tsx
  ----onOutflowUpdate.tsx
  ----onOutflowDelete.tsx
  --triggers
  --utils
  -outflowMain
  --api
  --dev
  --types
  ---outflow_type.tsx
  --crud
  --triggers
  --utils
  -outflowSummaries
  --api
  --dev
  --types
  ---outflow_summaries_type.tsx
  --crud
  ----updateOutflowSummaries.tsx
  ----createOutflowSummmaries.tsx
  ----deleteOutflowSummaries.tsx
  --triggers
  --utils

  --filesToBeDirected (this directory needs to be where all the files that I haven't specified specifically will live until we determine which directory they should live in.)
  

  Additionally, please include a brief, 3 sentance write up on every function within the outflows directory as it exists today, including if it is currently in use. Once complete, I'll outline step 2.



  ####Step 2
after we finish step 1 I'll outline step 2.