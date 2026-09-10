# Regeneration completion guard

Single-scene regeneration can preserve an existing video URL while a replacement is queued. The generation worker must not treat that previous media URL as proof that the new run completed.

A run is now considered complete only when every scoped scene both has a `videoUrl` and is in `completed` status. This preserves the previous clip until replacement succeeds while preventing false completion of a regeneration run.
