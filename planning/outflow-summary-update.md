
To Do List
Ensure fields in the outflowSummary doc match the fields in the outflow period
ensure the outflowsummary doc can be updated, via batch, by the periods





##onOutflowUpdate
- if userCustomName changes
- then update all periods in outflow summary that have that outflow ID

##onOutflowPeriodCreate
- if outflowPeriod created
- check if date is within window
-- if yes
--- addOutflowPeriodToOutflowSummary
-- if no
--- do nothing

##onOutflowPeriodUpdate
- if averageAmount changes
-- then update averageAmount for that outflowPeriod
continue for all other fields that are in the outflow summary so that it doesn't just run based on updated that aren't material

##onOutflowPeriodDelete
- if outflow period is deleted
-- then remove outflow period from the summary doc based on the period id

##batch write - include all changes that need to be made to the document in one go