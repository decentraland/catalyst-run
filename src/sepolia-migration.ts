import { Lifecycle } from '@well-known-components/interfaces'
// import { migrateContentFolderStructure } from '../migrations/ContentFolderMigrationManager'
import SQL from 'sql-template-strings'
import { streamToBuffer } from '@dcl/catalyst-storage/dist/content-item'
import { Authenticator } from '@dcl/crypto'
import EthCrypto from 'eth-crypto'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createCatalystClient } from 'dcl-catalyst-client'
import * as DeploymentBuilder from 'dcl-catalyst-client/dist/client/utils/DeploymentBuilder'
import { IPgComponent, createPgComponent } from '@well-known-components/pg-component'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createLogComponent } from '@well-known-components/logger'
import {
  IContentStorageComponent,
  createFolderBasedFileSystemContentStorage,
  createFsComponent
} from '@dcl/catalyst-storage'

type AppComponents = {
  database: IPgComponent
  storage: IContentStorageComponent
}

const SEPOLIA_MIGRATION_TIMESTAMP: number = process.env.SEPOLIA_MIGRATION_TIMESTAMP
  ? parseInt(process.env.SEPOLIA_MIGRATION_TIMESTAMP)
  : 1689096101514

void Lifecycle.run<AppComponents>({
  async main(program: Lifecycle.EntryPointParameters<AppComponents>): Promise<void> {
    const { components, startComponents, stop } = program

    // TODO: do I need this?
    // await components.migrationManager.run()
    // await migrateContentFolderStructure(components)

    await startComponents()

    await doMigration(components)

    await stop()
  },
  async initComponents(): Promise<AppComponents> {
    const config = await createDotEnvConfigComponent({})
    console.log(config)
    const metrics = createTestMetricsComponent({})
    const logs = await createLogComponent({})

    const fs = createFsComponent()
    const storage = await createFolderBasedFileSystemContentStorage({ logs, fs }, 'storage/contents')

    const database = await createPgComponent({ config, logs, metrics })

    return {
      database,
      storage
    }
  }
})

async function doMigration(components: AppComponents) {
  if (!process.env.MIGRATION_PRIVATE_KEY) {
    throw 'Cannot run migration without a deployer PK'
  }
  if (!process.env.TARGET_CATALYST_URL) {
    throw 'Need to specify a target Catalyst URL'
  }

  const privateKey = process.env.MIGRATION_PRIVATE_KEY
  const publicKey = EthCrypto.publicKeyByPrivateKey(privateKey)
  const address = EthCrypto.publicKey.toAddress(publicKey)
  console.log({ address, privateKey, publicKey })

  const result = await components.database.query(
    SQL`
        SELECT id, entity_type, entity_id, entity_timestamp, entity_pointers, entity_metadata
        FROM deployments
        WHERE entity_type = 'scene'
          AND deleter_deployment IS NULL
          AND entity_timestamp < to_timestamp(${SEPOLIA_MIGRATION_TIMESTAMP / 1000})
        ORDER BY entity_timestamp
    `
  )

  console.log(`About to attempt migration of ${result.rowCount} scenes`)

  let counter = 0
  for (const deployment of result.rows) {
    const deployment2 = deployment as any

    const fileResult = await components.database.query(
      SQL`
        SELECT *
        FROM content_files
        WHERE deployment = ${deployment2.id}
    `
    )

    const files: Map<string, Uint8Array> = new Map()

    for (const file of fileResult.rows) {
      const key = (file as any).key
      const hash = (file as any).content_hash
      const content = await components.storage.retrieve(hash)
      if (content) {
        files.set(key, await streamToBuffer(await content.asStream()))
      }
    }

    const metadata = deployment2.entity_metadata.v
    const entity = await DeploymentBuilder.buildEntity({
      type: deployment2.entity_type,
      pointers: deployment2.entity_pointers,
      files,
      metadata,
      timestamp: new Date().getTime()
    })
    console.log(`Deploying entity #${counter}: entity_id ${entity.entityId}`, JSON.stringify(metadata))

    const messageHash = Authenticator.createEthereumMessageHash(entity.entityId)
    const signature = EthCrypto.sign(privateKey, Buffer.from(messageHash).toString('hex'))
    const authChain = Authenticator.createSimpleAuthChain(entity.entityId, address, signature)

    const fetcher = createFetchComponent({
      defaultFetcherOptions: {
        timeout: 20 * 60 * 1000
      }
    })
    const client = createCatalystClient({
      fetcher,
      url: process.env.TARGET_CATALYST_URL
    })

    const contentClient = await client.getContentClient()

    try {
      await contentClient.deploy({
        entityId: entity.entityId,
        authChain: authChain,
        files: entity.files
      })
    } catch (e) {
      console.log(e)
      console.log(`Error deploying entity ${entity.entityId} on ${deployment2.entity_pointers}`)
    }
    counter++
  }
}