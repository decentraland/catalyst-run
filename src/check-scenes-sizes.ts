import { Lifecycle } from '@well-known-components/interfaces'
import SQL from 'sql-template-strings'
import { streamToBuffer } from '@dcl/catalyst-storage/dist/content-item'
import { IPgComponent, createPgComponent } from '@well-known-components/pg-component'
import { createConfigComponent, createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createLogComponent } from '@well-known-components/logger'
import {
  IContentStorageComponent,
  createFolderBasedFileSystemContentStorage,
  createFsComponent
} from '@dcl/catalyst-storage'
import plainFs from 'fs'

type AppComponents = {
  database: IPgComponent
  storage: IContentStorageComponent
}

const CONTENTS_DIRECTORY = process.env.CONTENTS_DIRECTORY ?? '/app/contents'

void Lifecycle.run<AppComponents>({
  async main(program: Lifecycle.EntryPointParameters<AppComponents>): Promise<void> {
    const { components, startComponents, stop } = program

    await startComponents()

    await analyzeSizes(components)

    await stop()
  },
  async initComponents(): Promise<AppComponents> {
    const config = await createDotEnvConfigComponent(
      {},
      {
        POSTGRES_HOST: 'postgres',
        POSTGRES_PORT: '5432'
      }
    )
    const metrics = createTestMetricsComponent({})
    const logs = await createLogComponent({})

    const fs = createFsComponent()
    const storage = await createFolderBasedFileSystemContentStorage({ logs, fs }, CONTENTS_DIRECTORY)

    const database = await createPgComponent({
      config: createConfigComponent({
        PG_COMPONENT_PSQL_HOST: await config.requireString('POSTGRES_HOST'),
        PG_COMPONENT_PSQL_PORT: await config.requireString('POSTGRES_PORT'),
        PG_COMPONENT_PSQL_DATABASE: await config.requireString('POSTGRES_CONTENT_DB'),
        PG_COMPONENT_PSQL_USER: await config.requireString('POSTGRES_CONTENT_USER'),
        PG_COMPONENT_PSQL_PASSWORD: await config.requireString('POSTGRES_CONTENT_PASSWORD')
      }),
      logs,
      metrics
    })

    return {
      database,
      storage
    }
  }
})

async function analyzeSizes(components: AppComponents) {
  const result = await components.database.query<any>(
    SQL`
            SELECT id, deployer_address, "version", entity_type, entity_id, entity_metadata, entity_timestamp, entity_pointers, local_timestamp, auth_chain, deleter_deployment
            FROM public.deployments
            WHERE entity_type = 'scene'
                AND deleter_deployment IS NULL
            ORDER BY entity_timestamp
        `
  )

  for (const deployment of result.rows) {
    const fileResult = await components.database.query(
      SQL`
        SELECT *
        FROM content_files
        WHERE deployment = ${deployment.id}
    `
    )
    const files = new Map<string, Uint8Array>()

    for (const file of fileResult.rows) {
      const key = (file as any).key
      const hash = (file as any).content_hash
      const content = await components.storage.retrieve(hash)
      if (content) {
        files.set(key, await streamToBuffer(await content.asStream()))
      } else {
        console.log(`no content found for hash: ${hash}`)
      }
    }

    const metadata = deployment.entity_metadata.v

    // remove navmapThumbnail if file is not present
    const sceneThumbnail = metadata?.display.navmapThumbnail
    if (sceneThumbnail) {
      if (!files.has(sceneThumbnail)) {
        metadata.display.navmapThumbnail = undefined
      }
    }

    let totalSize = 0
    for (const file of files.values()) {
      totalSize += file.byteLength
    }

    console.log(`Scene ${deployment.entity_id} has ${files.size} files with a total size of ${totalSize} bytes`)
    console.log(`Scene ${deployment.entity_id} has pointers: ${deployment.entity_pointers}`)

    const sizeInMb = totalSize / 1024 / 1024
    plainFs.appendFileSync(
      'report.log',
      `${deployment.entity_id}\n
       Amount of files: ${files.size}\n
       MB: ${sizeInMb}\n
       Pointers: ${deployment.entity_pointers}\n\n`
    )
  }
}
