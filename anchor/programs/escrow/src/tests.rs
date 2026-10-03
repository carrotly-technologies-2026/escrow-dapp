use crate::{accounts, instruction, Escrow, EscrowStatus, ID as PROGRAM_ID};
use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_sdk::{
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};

const SOL: u64 = 1_000_000_000;
const AMOUNT: u64 = 2 * SOL;
const START: i64 = 1_700_000_000;
const SHIP_IN: i64 = 3_600;
const CONFIRM_WINDOW: i64 = 600;
const ARBITER_WINDOW: i64 = 900;

struct Env {
    svm: LiteSVM,
    buyer: Keypair,
    seller: Keypair,
    arbiter: Keypair,
    stranger: Keypair,
    escrow: Pubkey,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(PROGRAM_ID, include_bytes!("../../../target/deploy/escrow.so"))
            .unwrap();
        let [buyer, seller, arbiter, stranger] = [(); 4].map(|_| Keypair::new());
        for kp in [&buyer, &seller, &arbiter, &stranger] {
            svm.airdrop(&kp.pubkey(), 10 * SOL).unwrap();
        }
        let escrow = Pubkey::find_program_address(
            &[b"escrow", buyer.pubkey().as_ref(), &1u64.to_le_bytes()],
            &PROGRAM_ID,
        )
        .0;
        let mut env = Env { svm, buyer, seller, arbiter, stranger, escrow };
        env.set_time(START);
        env
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&clock);
    }

    fn send(&mut self, data: Vec<u8>, metas: impl ToAccountMetas, signer: &Keypair) -> bool {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: metas.to_account_metas(None),
            data,
        };
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&signer.pubkey()),
            &[signer],
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).is_ok()
    }

    fn create(&mut self) -> bool {
        let data = instruction::CreateEscrow {
            escrow_id: 1,
            seller: self.seller.pubkey(),
            arbiter: self.arbiter.pubkey(),
            amount: AMOUNT,
            ship_deadline: START + SHIP_IN,
            confirm_window: CONFIRM_WINDOW,
            arbiter_window: ARBITER_WINDOW,
            details_hash: [7; 32],
        }
        .data();
        let metas = accounts::CreateEscrow {
            buyer: self.buyer.pubkey(),
            escrow: self.escrow,
            system_program: system_program::ID,
        };
        let buyer = self.buyer.insecure_clone();
        self.send(data, metas, &buyer)
    }

    fn ship(&mut self, signer: &Keypair) -> bool {
        let data = instruction::MarkShipped { waybill_hash: [9; 32] }.data();
        let metas = accounts::MarkShipped { seller: signer.pubkey(), escrow: self.escrow };
        self.send(data, metas, signer)
    }

    fn confirm(&mut self, signer: &Keypair) -> bool {
        let data = instruction::ConfirmReceived {}.data();
        let metas = accounts::ConfirmReceived {
            buyer: signer.pubkey(),
            escrow: self.escrow,
            seller: self.seller.pubkey(),
        };
        self.send(data, metas, signer)
    }

    fn dispute(&mut self, signer: &Keypair) -> bool {
        let data = instruction::OpenDispute {}.data();
        let metas = accounts::OpenDispute { party: signer.pubkey(), escrow: self.escrow };
        self.send(data, metas, signer)
    }

    fn resolve(&mut self, signer: &Keypair, seller_share_bps: u16) -> bool {
        let data = instruction::ResolveDispute { seller_share_bps }.data();
        let metas = accounts::ResolveDispute {
            arbiter: signer.pubkey(),
            escrow: self.escrow,
            buyer: self.buyer.pubkey(),
            seller: self.seller.pubkey(),
        };
        self.send(data, metas, signer)
    }

    fn claim(&mut self, signer: &Keypair) -> bool {
        let data = instruction::ClaimTimeout {}.data();
        let metas = accounts::ClaimTimeout {
            caller: signer.pubkey(),
            escrow: self.escrow,
            buyer: self.buyer.pubkey(),
            seller: self.seller.pubkey(),
        };
        self.send(data, metas, signer)
    }

    fn state(&self) -> Escrow {
        let account = self.svm.get_account(&self.escrow).unwrap();
        Escrow::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn balance(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }
}

/// Runs `f` and returns how much `who`'s balance changed (fees excluded when `who` didn't sign).
fn delta(env: &mut Env, who: Pubkey, f: impl FnOnce(&mut Env) -> bool) -> (bool, i128) {
    let before = env.balance(&who) as i128;
    let ok = f(env);
    (ok, env.balance(&who) as i128 - before)
}

#[test]
fn happy_path_buyer_confirms_and_seller_is_paid() {
    let mut env = Env::new();
    assert!(env.create());
    assert_eq!(env.state().status, EscrowStatus::Funded);
    assert!(env.balance(&env.escrow) > AMOUNT);

    let seller = env.seller.insecure_clone();
    assert!(env.ship(&seller));
    let state = env.state();
    assert_eq!(state.status, EscrowStatus::Shipped);
    assert_eq!(state.waybill_hash, [9; 32]);
    assert_eq!(state.confirm_deadline, START + CONFIRM_WINDOW);

    let buyer = env.buyer.insecure_clone();
    let seller_key = env.seller.pubkey();
    let (ok, gained) = delta(&mut env, seller_key, |e| e.confirm(&buyer));
    assert!(ok);
    assert_eq!(gained, AMOUNT as i128);
    assert_eq!(env.state().status, EscrowStatus::Released);
    // Settled escrows can't pay out twice.
    assert!(!env.confirm(&buyer));
}

#[test]
fn only_the_right_party_can_act() {
    let mut env = Env::new();
    assert!(env.create());
    let (buyer, stranger, arbiter) = (
        env.buyer.insecure_clone(),
        env.stranger.insecure_clone(),
        env.arbiter.insecure_clone(),
    );

    assert!(!env.ship(&stranger), "only seller ships");
    assert!(!env.ship(&buyer), "only seller ships");
    assert!(!env.confirm(&stranger), "only buyer confirms");
    assert!(!env.dispute(&stranger), "only parties dispute");
    assert!(!env.dispute(&arbiter), "arbiter can't open disputes");
    assert!(!env.resolve(&arbiter, 5_000), "no dispute to resolve");
    assert!(!env.claim(&stranger), "deadline not reached");
}

#[test]
fn rejects_invalid_creation() {
    let mut env = Env::new();
    let buyer = env.buyer.insecure_clone();
    let (seller_key, arbiter_key) = (env.seller.pubkey(), env.arbiter.pubkey());
    let make = |seller: Pubkey, amount: u64, ship_deadline: i64| instruction::CreateEscrow {
        escrow_id: 1,
        seller,
        arbiter: arbiter_key,
        amount,
        ship_deadline,
        confirm_window: CONFIRM_WINDOW,
        arbiter_window: ARBITER_WINDOW,
        details_hash: [0; 32],
    };
    let cases = [
        make(seller_key, 0, START + SHIP_IN),
        make(buyer.pubkey(), AMOUNT, START + SHIP_IN),
        make(seller_key, AMOUNT, START - 1),
    ];
    for ix in cases {
        let metas = accounts::CreateEscrow {
            buyer: buyer.pubkey(),
            escrow: env.escrow,
            system_program: system_program::ID,
        };
        assert!(!env.send(ix.data(), metas, &buyer));
    }
}

#[test]
fn not_shipped_in_time_refunds_buyer() {
    let mut env = Env::new();
    assert!(env.create());
    let (seller, stranger) = (env.seller.insecure_clone(), env.stranger.insecure_clone());

    env.set_time(START + SHIP_IN + 1);
    assert!(!env.ship(&seller), "too late to ship");

    let buyer_key = env.buyer.pubkey();
    let (ok, gained) = delta(&mut env, buyer_key, |e| e.claim(&stranger));
    assert!(ok, "anyone can trigger the timeout");
    assert_eq!(gained, AMOUNT as i128);
    assert_eq!(env.state().status, EscrowStatus::Refunded);
}

#[test]
fn silent_buyer_after_shipping_pays_seller() {
    let mut env = Env::new();
    assert!(env.create());
    let (seller, stranger) = (env.seller.insecure_clone(), env.stranger.insecure_clone());
    assert!(env.ship(&seller));

    env.set_time(START + CONFIRM_WINDOW);
    assert!(!env.claim(&stranger), "window still open");

    env.set_time(START + CONFIRM_WINDOW + 1);
    let seller_key = env.seller.pubkey();
    let (ok, gained) = delta(&mut env, seller_key, |e| e.claim(&stranger));
    assert!(ok);
    assert_eq!(gained, AMOUNT as i128);
    assert_eq!(env.state().status, EscrowStatus::Released);
}

#[test]
fn arbiter_splits_disputed_funds() {
    let mut env = Env::new();
    assert!(env.create());
    let (buyer, seller, arbiter) = (
        env.buyer.insecure_clone(),
        env.seller.insecure_clone(),
        env.arbiter.insecure_clone(),
    );
    assert!(env.ship(&seller));
    assert!(env.dispute(&buyer));
    assert_eq!(env.state().status, EscrowStatus::Disputed);
    assert!(!env.claim(&buyer), "frozen until arbiter window ends");
    assert!(!env.resolve(&seller, 10_000), "parties can't resolve");
    assert!(!env.resolve(&arbiter, 10_001), "share above 100%");

    let (buyer_key, seller_key) = (env.buyer.pubkey(), env.seller.pubkey());
    let buyer_before = env.balance(&buyer_key);
    let seller_before = env.balance(&seller_key);
    assert!(env.resolve(&arbiter, 2_500));
    assert_eq!(env.balance(&seller_key) - seller_before, AMOUNT / 4);
    assert_eq!(env.balance(&buyer_key) - buyer_before, AMOUNT * 3 / 4);
    let state = env.state();
    assert_eq!(state.status, EscrowStatus::Resolved);
    assert_eq!(state.seller_share_bps, 2_500);
}

#[test]
fn silent_arbiter_refunds_buyer() {
    let mut env = Env::new();
    assert!(env.create());
    let (seller, arbiter, stranger) = (
        env.seller.insecure_clone(),
        env.arbiter.insecure_clone(),
        env.stranger.insecure_clone(),
    );
    assert!(env.dispute(&seller), "seller can dispute too");

    env.set_time(START + ARBITER_WINDOW + 1);
    assert!(!env.resolve(&arbiter, 10_000), "arbiter too late");

    let buyer_key = env.buyer.pubkey();
    let (ok, gained) = delta(&mut env, buyer_key, |e| e.claim(&stranger));
    assert!(ok);
    assert_eq!(gained, AMOUNT as i128);
    assert_eq!(env.state().status, EscrowStatus::Refunded);
}

#[test]
fn buyer_can_concede_during_dispute() {
    let mut env = Env::new();
    assert!(env.create());
    let buyer = env.buyer.insecure_clone();
    assert!(env.dispute(&buyer));
    let seller_key = env.seller.pubkey();
    let (ok, gained) = delta(&mut env, seller_key, |e| e.confirm(&buyer));
    assert!(ok);
    assert_eq!(gained, AMOUNT as i128);
}
