
# Example

```
docker pull quay.io/decentraland/catalyst-run:next
docker run --env-file .env --env-file .env-database-content --rm -it --network="catalyst-owner_default" quay.io/decentraland/catalyst-run:next dist/sepolia-migration.js
```
