import {constants} from 'ethers'
import {createFixtureLoader} from 'ethereum-waffle'
import {waffle} from 'hardhat'
import {expect} from './shared/expect'
import {expandTo18Decimals, snapshotGasCost} from './shared/utils'
import multiSigWalletFixture, {MultiSigWalletFixture} from "./shared/multiSigWalletFixture";
import {MultiSigWallet} from "../typechain/MultiSigWallet";
import {ERC20Mock} from "../typechain/ERC20Mock";

const TEST_AMOUNT = expandTo18Decimals(100);

describe('MultiSigWallet', () => {
    const {AddressZero} = constants;
    const wallets = waffle.provider.getWallets();
    const [owner1, owner2, owner3, other] = wallets;
    const loadFixture = createFixtureLoader([owner1, owner2], waffle.provider);

    let fixture: MultiSigWalletFixture;
    let multiSigWallet: MultiSigWallet;
    let token: ERC20Mock;

    beforeEach(async () => {
        fixture = await loadFixture(multiSigWalletFixture);
        token = fixture.token;
        multiSigWallet = fixture.multiSigWallet;

        //transfer tokens to multiSigWallet
        await token.connect(owner1).transfer(fixture.multiSigWallet.address, TEST_AMOUNT);
    });

    it('requiredNum, ownerNums, nextPendingTxId, MAX_OWNERS', async () => {
        expect(await multiSigWallet.MAX_OWNERS()).to.eq(16);
        expect(await multiSigWallet.requiredNum()).to.eq(2);
        expect(await multiSigWallet.ownerNums()).to.eq(2);
        expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

        expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
        expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
        expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
        expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
        expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);

        expect(await multiSigWallet.hasConfirmed(0, owner1.address)).to.eq(false);
    });

    describe('#changeOwner', ()=>{
        describe("fail", ()=>{
            it("1 if it's not a action called by self", async () => {
                await expect(multiSigWallet.changeOwner(owner1.address, owner3.address))
                    .to.be.revertedWith("OSC");
            });

            it("2 if the from is not owner", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("changeOwner",
                    [owner3.address, other.address]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });

            it("3 if to is owner", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("changeOwner",
                    [owner1.address, owner2.address]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });

            it("4 if to == address(0)", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("changeOwner",
                    [owner1.address, AddressZero]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });
        });

        it('work', async () => {
            let data = multiSigWallet.interface.encodeFunctionData("changeOwner",
                [owner1.address, owner3.address]
            );

            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

            let txs = await multiSigWallet.txsOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);

            // owner2 confirm
            let tx = multiSigWallet.connect(owner2).confirm(1);
            await expect(tx)
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner2.address, 1)
                .to.emit(multiSigWallet, 'OwnerChanged')
                .withArgs(owner1.address, owner3.address)
                .to.emit(multiSigWallet, 'MultiTransact')
                .withArgs(owner2.address, 1, 0, multiSigWallet.address, data);
            await snapshotGasCost(tx);//gas

            // view pendingState
            txs = await multiSigWallet.txsOf(1);
            pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(AddressZero);
            expect(pendingState.yetNeeded).to.eq(0);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(2);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner3.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(false);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(true)
        });
    });

    describe('#addOwner', ()=>{
        describe("fail", ()=>{
            it("1 if it's not a action called by self", async () => {
                await expect(multiSigWallet.addOwner(owner3.address))
                    .to.be.revertedWith("OSC");
            });

            it("2 if the newOwner is owner", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                    [owner1.address]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });

            //???MAX_OWNERS
        });

        it('work', async () => {
            let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                [owner3.address]
            );

            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

            let txs = await multiSigWallet.txsOf(1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);

            // owner2 confirm
            let tx = multiSigWallet.connect(owner2).confirm(1);
            await expect(tx)
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner2.address, 1)
                .to.emit(multiSigWallet, 'OwnerAdded')
                .withArgs(owner3.address)
                .to.emit(multiSigWallet, 'MultiTransact')
                .withArgs(owner2.address, 1, 0, multiSigWallet.address, data);
            await snapshotGasCost(tx);//gas

            // view pendingState
            txs = await multiSigWallet.txsOf(1);
            pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(AddressZero);
            expect(pendingState.yetNeeded).to.eq(0);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(3);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.getOwner(2)).to.eq(owner3.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(true);
        });
    });

    describe('#removeOwner', ()=>{
        describe("fail", ()=>{
            it("1 if it's not a action called by self", async () => {
                await expect(multiSigWallet.removeOwner(owner3.address))
                    .to.be.revertedWith("OSC");
            });

            it("2 if the address is not owner", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("removeOwner",
                    [owner3.address]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });

            it("3 if ownerNums <= requiredNum", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("removeOwner",
                    [owner1.address]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });
        });

        describe("work", ()=>{
            beforeEach("requiredNum=2, ownerNums=3", async () => {
                //add owner
                let addData = multiSigWallet.interface.encodeFunctionData("addOwner",
                    [owner3.address]
                );
                await multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, addData);
                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(true);
                await multiSigWallet.connect(owner2).confirm(1);
            });

            it('1 if ownerIndex is first', async () => {
                let data = multiSigWallet.interface.encodeFunctionData("removeOwner",
                    [owner1.address]
                );

                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                let txs = await multiSigWallet.txsOf(1);
                let pendingState = await multiSigWallet.pendingOf(1);
                expect(txs.to).to.eq(multiSigWallet.address);
                expect(txs.value).to.eq(0);
                expect(txs.data).to.eq(data);
                expect(pendingState.yetNeeded).to.eq(1);
                expect(pendingState.ownersDone).to.eq(2);

                // owner2 confirm
                let tx = multiSigWallet.connect(owner2).confirm(1);
                await expect(tx)
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner2.address, 1)
                    .to.emit(multiSigWallet, 'OwnerRemoved')
                    .withArgs(owner1.address)
                    .to.emit(multiSigWallet, 'MultiTransact')
                    .withArgs(owner2.address, 1, 0, multiSigWallet.address, data);
                await snapshotGasCost(tx);//gas

                // view pendingState
                txs = await multiSigWallet.txsOf(1);
                pendingState = await multiSigWallet.pendingOf(1);
                expect(txs.to).to.eq(AddressZero);
                expect(pendingState.yetNeeded).to.eq(0);
                expect(pendingState.ownersDone).to.eq(0);

                // results
                expect(await multiSigWallet.requiredNum()).to.eq(2);
                expect(await multiSigWallet.ownerNums()).to.eq(2);
                expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

                expect(await multiSigWallet.getOwner(0)).to.eq(owner3.address);
                expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
                expect(await multiSigWallet.isOwner(owner1.address)).to.eq(false);
                expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
                expect(await multiSigWallet.isOwner(owner3.address)).to.eq(true);
            });

            it('2 if ownerIndex is last', async () => {
                let data = multiSigWallet.interface.encodeFunctionData("removeOwner",
                    [owner3.address]
                );

                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                let tx = multiSigWallet.connect(owner2).confirm(1);
                await expect(tx)
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner2.address, 1)
                    .to.emit(multiSigWallet, 'OwnerRemoved')
                    .withArgs(owner3.address)
                    .to.emit(multiSigWallet, 'MultiTransact')
                    .withArgs(owner2.address, 1, 0, multiSigWallet.address, data);
                await snapshotGasCost(tx);//gas

                // view pendingState
                let txs = await multiSigWallet.txsOf(1);
                let pendingState = await multiSigWallet.pendingOf(1);
                expect(txs.to).to.eq(AddressZero);
                expect(pendingState.yetNeeded).to.eq(0);
                expect(pendingState.ownersDone).to.eq(0);

                // results
                expect(await multiSigWallet.requiredNum()).to.eq(2);
                expect(await multiSigWallet.ownerNums()).to.eq(2);
                expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

                expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
                expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
                expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
                expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
                expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);
            })
        })
    });

    describe('#changeRequirement', ()=>{
        describe("fail", ()=>{
            it("1 if it's not a action called by self", async () => {
                await expect(multiSigWallet.changeRequirement(1))
                    .to.be.revertedWith("OSC");
            });

            it("2 if newRequired > ownerNums", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("changeRequirement",
                    [3]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });

            it("3 if newRequired == 0", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("changeRequirement",
                    [0]
                );
                // create pending tx
                await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                    .to.emit(multiSigWallet, 'Confirmation')
                    .withArgs(owner1.address, 1)
                    .to.emit(multiSigWallet, 'ConfirmationNeeded')
                    .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

                // owner2 confirm
                expect(await multiSigWallet.connect(owner2).callStatic.confirm(1)).to.eq(false);
            });
        });

        it('work', async () => {
            let data = multiSigWallet.interface.encodeFunctionData("changeRequirement",
                [1]
            );

            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

            let txs = await multiSigWallet.txsOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);

            // owner2 confirm
            let tx = multiSigWallet.connect(owner2).confirm(1);
            await expect(tx)
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner2.address, 1)
                .to.emit(multiSigWallet, 'RequirementChanged')
                .withArgs(1)
                .to.emit(multiSigWallet, 'MultiTransact')
                .withArgs(owner2.address, 1, 0, multiSigWallet.address, data);
            await snapshotGasCost(tx);//gas

            // view pendingState
            txs = await multiSigWallet.txsOf(1);
            pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(AddressZero);
            expect(pendingState.yetNeeded).to.eq(0);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(1);
            expect(await multiSigWallet.ownerNums()).to.eq(2);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);
        });
    });

    describe("#revoke", ()=>{
        beforeEach("create pending tx", async () => {
            //add owner
            let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                [owner3.address]
            );
            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

            let txs = await multiSigWallet.txsOf(1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);
        });

        describe("fail", ()=>{
            it("1 if it's not a action called by owner", async () => {
                await expect(multiSigWallet.connect(owner3).revoke(1))
                    .to.be.revertedWith("OC");
            });

            it("2 if txId is invalid", async () => {
                await expect(multiSigWallet.connect(owner1).revoke(10))
                    .to.be.revertedWith("OD");
            });
        });

        it('work', async () => {
            let tx = multiSigWallet.connect(owner1).revoke(1);
            await expect(tx)
                .to.emit(multiSigWallet, 'Revoke')
                .withArgs(owner1.address, 1);
            await snapshotGasCost(tx);//gas

            // view pendingState
            let txs = await multiSigWallet.txsOf(1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(pendingState.yetNeeded).to.eq(2);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(2);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(2);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);
        });
    });

    describe("#execute", ()=>{
        describe("fail", ()=>{
            it("1 if it's not a action called by owner", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                    [owner3.address]
                );
                await expect(multiSigWallet.connect(owner3).execute(multiSigWallet.address, 0, data))
                    .to.be.revertedWith("OC");
            });

            it("2 if to == address(0)", async () => {
                let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                    [owner3.address]
                );
                await expect(multiSigWallet.connect(owner1).execute(AddressZero, 0, data))
                    .to.be.revertedWith("EX");
            });
        });

        it('work', async () => {
            //add owner
            let data = multiSigWallet.interface.encodeFunctionData("addOwner",
                [owner3.address]
            );
            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data);

            let txs = await multiSigWallet.txsOf(1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(2);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(2);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);
        });
    });

    describe("#confirm", ()=>{
        let data1: any;
        let data2: any;
        beforeEach("create pending tx", async () => {
            //self call
            data1 = multiSigWallet.interface.encodeFunctionData("addOwner",
                [owner3.address]
            );
            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(multiSigWallet.address, 0, data1))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 1)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(1, owner1.address, 0, multiSigWallet.address, data1);

            let txs = await multiSigWallet.txsOf(1);
            expect(txs.to).to.eq(multiSigWallet.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);

            //other call
            data2 = token.interface.encodeFunctionData("transfer",
                [owner3.address, TEST_AMOUNT]
            );
            // create pending tx
            await expect(multiSigWallet.connect(owner1).execute(token.address, 0, data2))
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner1.address, 2)
                .to.emit(multiSigWallet, 'ConfirmationNeeded')
                .withArgs(2, owner1.address, 0, token.address, data2);

            txs = await multiSigWallet.txsOf(2);
            pendingState = await multiSigWallet.pendingOf(2);
            expect(txs.to).to.eq(token.address);
            expect(txs.value).to.eq(0);
            expect(txs.data).to.eq(data2);
            expect(pendingState.yetNeeded).to.eq(1);
            expect(pendingState.ownersDone).to.eq(2);
        });

        describe("fail", ()=>{
            it("1 if it's not a action called by owner", async () => {
                await expect(multiSigWallet.connect(owner3).confirm(1))
                    .to.be.revertedWith("OC");
            });

            it("2 if txId is invalid", async () => {
                await expect(multiSigWallet.connect(owner1).confirm(10))
                    .to.be.revertedWith("TXI");
            });
        });

        it('work self call', async () => {
            // owner2 confirm
            let tx = multiSigWallet.connect(owner2).confirm(1);
            await expect(tx)
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner2.address, 1)
                .to.emit(multiSigWallet, 'OwnerAdded')
                .withArgs(owner3.address)
                .to.emit(multiSigWallet, 'MultiTransact')
                .withArgs(owner2.address, 1, 0, multiSigWallet.address, data1);
            await snapshotGasCost(tx);//gas

            // view pendingState
            let txs = await multiSigWallet.txsOf(1);
            let pendingState = await multiSigWallet.pendingOf(1);
            expect(txs.to).to.eq(AddressZero);
            expect(pendingState.yetNeeded).to.eq(0);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(3);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(1);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.getOwner(2)).to.eq(owner3.address);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(true);
        });

        it('work other call', async () => {
            // owner2 confirm
            let tx = multiSigWallet.connect(owner2).confirm(2);
            await expect(tx)
                .to.emit(multiSigWallet, 'Confirmation')
                .withArgs(owner2.address, 2)
                .to.emit(token, 'Transfer')
                .withArgs(multiSigWallet.address, owner3.address, TEST_AMOUNT)
                .to.emit(multiSigWallet, 'MultiTransact')
                .withArgs(owner2.address, 2, 0, token.address, data2);
            await snapshotGasCost(tx);//gas

            // view pendingState
            let txs = await multiSigWallet.txsOf(2);
            let pendingState = await multiSigWallet.pendingOf(2);
            expect(txs.to).to.eq(AddressZero);
            expect(pendingState.yetNeeded).to.eq(0);
            expect(pendingState.ownersDone).to.eq(0);

            // results
            expect(await multiSigWallet.requiredNum()).to.eq(2);
            expect(await multiSigWallet.ownerNums()).to.eq(2);
            expect(await multiSigWallet.nextPendingTxId()).to.eq(3);

            expect(await multiSigWallet.getOwner(0)).to.eq(owner1.address);
            expect(await multiSigWallet.getOwner(1)).to.eq(owner2.address);
            expect(await multiSigWallet.getOwner(2)).to.eq(AddressZero);
            expect(await multiSigWallet.isOwner(owner1.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner2.address)).to.eq(true);
            expect(await multiSigWallet.isOwner(owner3.address)).to.eq(false);
        });
    })
});
