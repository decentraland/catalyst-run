import * as DeploymentBuilder from 'dcl-catalyst-client/dist/client/utils/DeploymentBuilder'
import EthCrypto from 'eth-crypto'
import { Authenticator } from '@dcl/crypto'
import { createCatalystClient } from 'dcl-catalyst-client'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { Profile } from '@dcl/schemas'

const sourceCatalystUrl = process.env.SOURCE_CATALYST_URL
const targetCatalystUrl = process.env.TARGET_CATALYST_URL
const privateKey = process.env.MIGRATION_PRIVATE_KEY

async function main() {
  if (!sourceCatalystUrl) {
    throw new Error('SOURCE_CATALYST_URL not provided')
  }

  if (!targetCatalystUrl) {
    throw new Error('TARGET_CATALYST_URL not provided')
  }

  if (!privateKey) {
    throw new Error('MIGRATION_PRIVATE_KEY not provided')
  }

  const publicKey = EthCrypto.publicKeyByPrivateKey(privateKey)
  const address = EthCrypto.publicKey.toAddress(publicKey)

  const fetcher = createFetchComponent()
  const sourceContentClient = await createCatalystClient({ url: sourceCatalystUrl, fetcher }).getContentClient()
  const targetContentClient = await createCatalystClient({ url: targetCatalystUrl, fetcher }).getContentClient()

  const pointers = []
  for (let i = 0; i < 160; i++) {
    pointers.push(`default${i + 1}`)
  }

  const entities = await sourceContentClient.fetchEntitiesByPointers(pointers)

  for (const entity of entities) {
    if (entity.type !== 'profile') {
      continue
    }

    const files = new Map<string, Uint8Array>()
    for (const content of entity.content) {
      const data = await sourceContentClient.downloadContent(content.hash)
      files.set(content.file, Buffer.from(data))
    }

    const profile: Profile = entity.metadata
    for (const avatar of profile.avatars) {
      avatar.hasClaimedName = avatar.hasClaimedName ?? false
      avatar.avatar.emotes = avatar.avatar.emotes ?? []
    }

    if (!Profile.validate(profile)) {
      console.log(profile)
      console.error(Profile.validate.errors)
      continue
    }

    const deploymentEntity = await DeploymentBuilder.buildEntity({
      type: entity.type,
      pointers: entity.pointers,
      files,
      metadata: profile,
      timestamp: Date.now()
    })
    console.log(`Deploying: ${entity.pointers[0]} ${deploymentEntity.entityId}`)

    const messageHash = Authenticator.createEthereumMessageHash(deploymentEntity.entityId)
    const signature = EthCrypto.sign(privateKey!, Buffer.from(messageHash).toString('hex'))
    const authChain = Authenticator.createSimpleAuthChain(deploymentEntity.entityId, address, signature)

    try {
      await targetContentClient.deploy({
        entityId: deploymentEntity.entityId,
        authChain: authChain,
        files: deploymentEntity.files
      })
    } catch (e) {
      console.error(e)
      console.log(`Error deploying: ${entity.pointers[0]} ${deploymentEntity.entityId}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
