
# Example

```
docker pull quay.io/decentraland/catalyst-run:next
docker run --env-file .env --env-file .env-database-content -e TARGET_CATALYST_URL=https://peer-ue-2.decentraland.zone --rm -it --network="catalyst-owner_default" --mount type=bind,src=/opt/ebs/contents,dst=/app/contents quay.io/decentraland/catalyst-run:next dist/sepolia-migration.js
docker run --env-file .env --env-file .env-database-content -e TARGET_CATALYST_URL=https://peer-ue-2.decentraland.zone -e MIGRATION_PRIVATE_KEY=xx --rm -it --network="catalyst-owner_default" --mount type=bind,src=/opt/ebs/contents,dst=/app/contents quay.io/decentraland/catalyst-run:next dist/sepolia-migration.js
```


Or just run a node cli:

```
docker run --env-file .env --env-file .env-database-content  --rm -it --network="catalyst-owner_default" quay.io/decentraland/catalyst-run:next
```

## Running check-scenes-sizes
```
docker run --env-file /opt/ebs/catalyst-owner/.env --env-file /opt/ebs/catalyst-owner/.env-database-content -e CONTENTS_DIRECTORY=/shared/contents -e OUTPUT_DIRECTORY=/shared/script-output --rm -it --network="catalyst-owner_default" --mount type=bind,src=/opt/ebs,dst=/shared quay.io/decentraland/catalyst-run:next dist/check-scenes-sizes.js
```
