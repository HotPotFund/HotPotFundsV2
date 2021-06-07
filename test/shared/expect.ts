import { expect, use } from 'chai'
import { solidity } from 'ethereum-waffle'
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot'

use(require('chai-shallow-deep-equal'));
use(solidity)
use(jestSnapshotPlugin())

export { expect }
