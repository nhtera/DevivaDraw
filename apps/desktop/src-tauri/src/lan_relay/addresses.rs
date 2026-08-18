//! Which address to hand out as the join URL's host.
//!
//! The relay binds `0.0.0.0`, so it is reachable on every interface — but a URL needs one host, and
//! guessing wrong produces a link that looks fine and reaches nothing. Machines routinely have
//! several candidates at once (Wi-Fi plus a docking-station ethernet plus a VM bridge), so this
//! enumerates them, discards what could not possibly work, orders the rest by how likely each is to
//! be the network the other person is actually on, and lets the host pick when more than one
//! survives. Ordering is a default, never a decision made behind the user's back.
//!
//! Public addresses are excluded deliberately, not accidentally: this feature hosts a room on a local
//! network, and offering a publicly-routable host would invite exposing a relay to the internet from
//! a laptop, which is a different feature with entirely different security questions.

use std::net::{IpAddr, Ipv4Addr};

/// One address the host could publish, with a label to tell two of them apart in the UI.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct HostAddress {
    /// Dotted-quad, ready to drop into a URL host position.
    pub address: String,
    /// The OS's name for the interface (`en0`, `Wi-Fi`, …) — the only thing that distinguishes two
    /// otherwise-identical-looking private addresses to a human.
    pub interface: String,
}

/// Every private IPv4 the machine currently holds, best candidate first. Empty means the machine is
/// on no local network at all, which the UI must report as such rather than showing a dead URL.
pub fn private_ipv4_addresses() -> Vec<HostAddress> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut candidates: Vec<(u8, HostAddress)> = interfaces
        .into_iter()
        .filter(|interface| !interface.is_loopback())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(address) => rank(address).map(|rank| (rank, HostAddress { address: address.to_string(), interface: interface.name })),
            // IPv6 is skipped on purpose: a literal IPv6 host needs bracket syntax and a zone index
            // for link-local, which is a URL people cannot read back to each other over a table.
            IpAddr::V6(_) => None,
        })
        .collect();
    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.address.cmp(&right.1.address)));
    candidates.into_iter().map(|(_, address)| address).collect()
}

/// Lower ranks sort first. `None` means the address cannot serve a LAN room at all.
fn rank(address: Ipv4Addr) -> Option<u8> {
    let [first, second, ..] = address.octets();
    match (first, second) {
        // The overwhelmingly common home/office network, so it is the overwhelmingly likely answer.
        (192, 168) => Some(0),
        // Corporate and larger networks.
        (10, _) => Some(1),
        (172, 16..=31) => Some(2),
        // Link-local (APIPA). Ranked last because it usually means DHCP failed — but it is exactly
        // what two laptops joined by a single ethernet cable and no router end up with, which is the
        // most air-gapped case this feature has, so excluding it would break the best example of it.
        (169, 254) => Some(3),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_every_private_range_and_link_local() {
        assert_eq!(rank(Ipv4Addr::new(192, 168, 1, 5)), Some(0));
        assert_eq!(rank(Ipv4Addr::new(10, 0, 0, 7)), Some(1));
        assert_eq!(rank(Ipv4Addr::new(172, 16, 0, 1)), Some(2));
        assert_eq!(rank(Ipv4Addr::new(172, 31, 255, 254)), Some(2));
        assert_eq!(rank(Ipv4Addr::new(169, 254, 3, 4)), Some(3));
    }

    #[test]
    fn rejects_public_addresses_so_hosting_stays_a_local_network_feature() {
        assert_eq!(rank(Ipv4Addr::new(8, 8, 8, 8)), None);
        assert_eq!(rank(Ipv4Addr::new(203, 0, 113, 9)), None);
    }

    #[test]
    fn rejects_the_ranges_that_only_look_private() {
        // 172.15 and 172.32 bracket the real 172.16/12 block; both are public.
        assert_eq!(rank(Ipv4Addr::new(172, 15, 0, 1)), None);
        assert_eq!(rank(Ipv4Addr::new(172, 32, 0, 1)), None);
        // 192.167 and 192.169 bracket 192.168/16.
        assert_eq!(rank(Ipv4Addr::new(192, 167, 0, 1)), None);
        assert_eq!(rank(Ipv4Addr::new(192, 169, 0, 1)), None);
    }

    #[test]
    fn prefers_the_most_likely_network_first() {
        let mut ranks = [Ipv4Addr::new(169, 254, 1, 1), Ipv4Addr::new(10, 1, 1, 1), Ipv4Addr::new(192, 168, 1, 1)];
        ranks.sort_by_key(|address| rank(*address));
        assert_eq!(ranks[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(ranks[2], Ipv4Addr::new(169, 254, 1, 1));
    }

    #[test]
    fn enumerating_the_real_machine_never_panics_and_never_offers_a_public_address() {
        // Whatever this machine is on (including nothing), the contract must hold.
        for candidate in private_ipv4_addresses() {
            let parsed: Ipv4Addr = candidate.address.parse().expect("enumerated a non-IPv4 address");
            assert!(rank(parsed).is_some(), "offered a non-private address: {}", candidate.address);
        }
    }
}
