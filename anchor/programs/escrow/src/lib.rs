//! Escrow for buyer-seller shipments with a human arbiter for disputes.
//!
//! This program is the only place the deal's rules are enforced: who may move the
//! funds, when, and to whom. There is no admin; payouts can only ever go to the
//! buyer or seller recorded at creation, and every state has a deadline with a
//! default outcome, so funds can never get stuck if a party disappears.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

#[cfg(test)]
mod tests;

declare_id!("98XjuZZg6GLMZR36ouh2dXtYfDpCp5zLKjtLaSpJGDXj");

/// Upper bound for every deadline/window, so a typo can't lock funds for decades.
const MAX_PERIOD_SECS: i64 = 365 * 24 * 60 * 60;
const MAX_BPS: u16 = 10_000;

#[program]
pub mod escrow {
    use super::*;

    /// Buyer locks `amount` lamports for `seller`, naming the `arbiter` for disputes.
    #[allow(clippy::too_many_arguments)]
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        escrow_id: u64,
        seller: Pubkey,
        arbiter: Pubkey,
        amount: u64,
        ship_deadline: i64,
        confirm_window: i64,
        arbiter_window: i64,
        details_hash: [u8; 32],
    ) -> Result<()> {
        let buyer = ctx.accounts.buyer.key();
        let now = Clock::get()?.unix_timestamp;

        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            seller != buyer && arbiter != buyer && arbiter != seller,
            EscrowError::PartiesMustDiffer
        );
        require!(
            ship_deadline > now && ship_deadline - now <= MAX_PERIOD_SECS,
            EscrowError::InvalidPeriod
        );
        require!(
            (1..=MAX_PERIOD_SECS).contains(&confirm_window)
                && (1..=MAX_PERIOD_SECS).contains(&arbiter_window),
            EscrowError::InvalidPeriod
        );

        transfer(
            CpiContext::new(
                System::id(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.escrow.set_inner(Escrow {
            buyer,
            seller,
            arbiter,
            escrow_id,
            amount,
            status: EscrowStatus::Funded,
            created_at: now,
            ship_deadline,
            confirm_window,
            arbiter_window,
            confirm_deadline: 0,
            dispute_deadline: 0,
            details_hash,
            waybill_hash: [0; 32],
            seller_share_bps: 0,
            bump: ctx.bumps.escrow,
        });
        Ok(())
    }

    /// Seller commits the SHA-256 of the shipping waybill; starts the buyer's confirm window.
    pub fn mark_shipped(ctx: Context<MarkShipped>, waybill_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;

        require!(escrow.status == EscrowStatus::Funded, EscrowError::InvalidStatus);
        require!(now <= escrow.ship_deadline, EscrowError::DeadlinePassed);
        require!(waybill_hash != [0; 32], EscrowError::InvalidWaybill);

        escrow.waybill_hash = waybill_hash;
        escrow.confirm_deadline = now + escrow.confirm_window;
        escrow.status = EscrowStatus::Shipped;
        Ok(())
    }

    /// Buyer releases the full amount to the seller. Always safe for the buyer to do,
    /// so it is also allowed before shipping and during a dispute (buyer concedes).
    pub fn confirm_received(ctx: Context<ConfirmReceived>) -> Result<()> {
        require!(
            matches!(
                ctx.accounts.escrow.status,
                EscrowStatus::Funded | EscrowStatus::Shipped | EscrowStatus::Disputed
            ),
            EscrowError::InvalidStatus
        );
        let amount = ctx.accounts.escrow.amount;
        pay(&ctx.accounts.escrow, &ctx.accounts.seller, amount)?;
        ctx.accounts.escrow.status = EscrowStatus::Released;
        Ok(())
    }

    /// Either party freezes the funds until the arbiter decides (or the arbiter window ends).
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let caller = ctx.accounts.party.key();
        let now = Clock::get()?.unix_timestamp;

        require!(
            caller == escrow.buyer || caller == escrow.seller,
            EscrowError::Unauthorized
        );
        let deadline = match escrow.status {
            EscrowStatus::Funded => escrow.ship_deadline,
            EscrowStatus::Shipped => escrow.confirm_deadline,
            _ => return err!(EscrowError::InvalidStatus),
        };
        require!(now <= deadline, EscrowError::DeadlinePassed);

        escrow.dispute_deadline = now + escrow.arbiter_window;
        escrow.status = EscrowStatus::Disputed;
        Ok(())
    }

    /// Arbiter splits the funds; it can only pay the two parties, never itself.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, seller_share_bps: u16) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let escrow = &ctx.accounts.escrow;

        require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);
        require!(now <= escrow.dispute_deadline, EscrowError::DeadlinePassed);
        require!(seller_share_bps <= MAX_BPS, EscrowError::InvalidShare);

        let seller_amount =
            (escrow.amount as u128 * seller_share_bps as u128 / MAX_BPS as u128) as u64;
        let buyer_amount = escrow.amount - seller_amount;
        pay(&ctx.accounts.escrow, &ctx.accounts.seller, seller_amount)?;
        pay(&ctx.accounts.escrow, &ctx.accounts.buyer, buyer_amount)?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.seller_share_bps = seller_share_bps;
        escrow.status = EscrowStatus::Resolved;
        Ok(())
    }

    /// After a deadline passes, anyone can execute the default outcome:
    /// not shipped → refund buyer; shipped but buyer silent → pay seller;
    /// arbiter silent → refund buyer.
    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let escrow = &ctx.accounts.escrow;
        let amount = escrow.amount;

        let (deadline, to_seller) = match escrow.status {
            EscrowStatus::Funded => (escrow.ship_deadline, false),
            EscrowStatus::Shipped => (escrow.confirm_deadline, true),
            EscrowStatus::Disputed => (escrow.dispute_deadline, false),
            _ => return err!(EscrowError::InvalidStatus),
        };
        require!(now > deadline, EscrowError::DeadlineNotReached);

        if to_seller {
            pay(&ctx.accounts.escrow, &ctx.accounts.seller, amount)?;
            ctx.accounts.escrow.status = EscrowStatus::Released;
        } else {
            pay(&ctx.accounts.escrow, &ctx.accounts.buyer, amount)?;
            ctx.accounts.escrow.status = EscrowStatus::Refunded;
        }
        Ok(())
    }
}

/// Moves lamports out of the program-owned escrow account. Only `amount` is ever paid
/// out, never the rent-exempt reserve, so the account stays as an on-chain record.
fn pay<'info>(
    escrow: &Account<'info, Escrow>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    escrow.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub escrow_id: u64,
    pub amount: u64,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub ship_deadline: i64,
    pub confirm_window: i64,
    pub arbiter_window: i64,
    pub confirm_deadline: i64,
    pub dispute_deadline: i64,
    /// sha256(itemTitle + "\n" + recipientName + "\n" + recipientAddress), set by the buyer.
    pub details_hash: [u8; 32],
    /// sha256 of the waybill file, committed by the seller in `mark_shipped`.
    pub waybill_hash: [u8; 32],
    pub seller_share_bps: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum EscrowStatus {
    Funded,
    Shipped,
    Disputed,
    Released,
    Refunded,
    Resolved,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), &escrow_id.to_le_bytes()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkShipped<'info> {
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller @ EscrowError::Unauthorized)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ConfirmReceived<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, has_one = buyer @ EscrowError::Unauthorized, has_one = seller)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: only receives lamports; address pinned by `has_one = seller`.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub party: Signer<'info>,
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub arbiter: Signer<'info>,
    #[account(
        mut,
        has_one = arbiter @ EscrowError::Unauthorized,
        has_one = buyer,
        has_one = seller
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: only receives lamports; address pinned by `has_one = buyer`.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: only receives lamports; address pinned by `has_one = seller`.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    /// Anyone may trigger the default outcome; they only pay the transaction fee.
    pub caller: Signer<'info>,
    #[account(mut, has_one = buyer, has_one = seller)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: only receives lamports; address pinned by `has_one = buyer`.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: only receives lamports; address pinned by `has_one = seller`.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Buyer, seller and arbiter must be different accounts")]
    PartiesMustDiffer,
    #[msg("Deadline or window is out of range")]
    InvalidPeriod,
    #[msg("Operation not allowed in the current escrow status")]
    InvalidStatus,
    #[msg("Deadline has passed")]
    DeadlinePassed,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Signer is not allowed to perform this operation")]
    Unauthorized,
    #[msg("Waybill hash must not be empty")]
    InvalidWaybill,
    #[msg("Seller share must be between 0 and 10000 basis points")]
    InvalidShare,
}
