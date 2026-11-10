package com.safedeal.infrastructure.blockchain;

import com.safedeal.domain.blockchain.OnChainEventType;
import com.safedeal.domain.blockchain.OnChainTradeSnapshot;
import com.safedeal.domain.blockchain.VerifiedChainEvent;
import java.math.BigInteger;
import java.util.List;
import java.util.Optional;
import org.web3j.abi.EventEncoder;
import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.FunctionReturnDecoder;
import org.web3j.abi.TypeReference;
import org.web3j.abi.datatypes.Address;
import org.web3j.abi.datatypes.Bool;
import org.web3j.abi.datatypes.Event;
import org.web3j.abi.datatypes.Function;
import org.web3j.abi.datatypes.Type;
import org.web3j.abi.datatypes.generated.Bytes32;
import org.web3j.abi.datatypes.generated.Uint256;
import org.web3j.abi.datatypes.generated.Uint64;
import org.web3j.abi.datatypes.generated.Uint8;
import org.web3j.protocol.core.methods.response.Log;
import org.web3j.utils.Numeric;

public final class SafeDealContractCodec {

    private static final Event TRADE_CREATED = new Event(
        "TradeCreated",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Address>(false) {},
            new TypeReference<Uint256>(false) {},
            new TypeReference<Bytes32>(false) {},
            new TypeReference<Uint64>(false) {},
            new TypeReference<Uint64>(false) {},
            new TypeReference<Uint64>(false) {}
        )
    );

    private static final Event TRADE_FUNDED = new Event(
        "TradeFunded",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Uint256>(false) {}
        )
    );

    private static final Event DELIVERY_MARKED = new Event(
        "DeliveryMarked",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Uint64>(false) {}
        )
    );

    private static final Event FUNDS_RELEASED = new Event(
        "FundsReleased",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Uint256>(false) {}
        )
    );

    private static final Event REFUND_EXECUTED = new Event(
        "RefundExecuted",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Uint256>(false) {},
            new TypeReference<Address>(true) {}
        )
    );

    private static final Event DISPUTE_OPENED = new Event(
        "DisputeOpened",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {}
        )
    );

    private static final Event DISPUTE_RESOLVED = new Event(
        "DisputeResolved",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Address>(true) {},
            new TypeReference<Uint256>(false) {},
            new TypeReference<Address>(false) {},
            new TypeReference<Uint256>(false) {}
        )
    );

    private static final Event FUNDS_WITHDRAWN = new Event(
        "FundsWithdrawn",
        List.of(
            new TypeReference<Address>(true) {},
            new TypeReference<Uint256>(false) {}
        )
    );

    private static final Event TRADE_CANCELLED = new Event(
        "TradeCancelled",
        List.of(
            new TypeReference<Bytes32>(true) {},
            new TypeReference<Address>(true) {}
        )
    );

    private static final String SIG_TRADE_CREATED = EventEncoder.encode(TRADE_CREATED);
    private static final String SIG_TRADE_FUNDED = EventEncoder.encode(TRADE_FUNDED);
    private static final String SIG_DELIVERY_MARKED = EventEncoder.encode(DELIVERY_MARKED);
    private static final String SIG_FUNDS_RELEASED = EventEncoder.encode(FUNDS_RELEASED);
    private static final String SIG_REFUND_EXECUTED = EventEncoder.encode(REFUND_EXECUTED);
    private static final String SIG_DISPUTE_OPENED = EventEncoder.encode(DISPUTE_OPENED);
    private static final String SIG_DISPUTE_RESOLVED = EventEncoder.encode(DISPUTE_RESOLVED);
    private static final String SIG_FUNDS_WITHDRAWN = EventEncoder.encode(FUNDS_WITHDRAWN);
    private static final String SIG_TRADE_CANCELLED = EventEncoder.encode(TRADE_CANCELLED);

    private static final List<TypeReference<?>> GET_TRADE_OUTPUTS = List.of(
        new TypeReference<Bytes32>() {},
        new TypeReference<Address>() {},
        new TypeReference<Address>() {},
        new TypeReference<Address>() {},
        new TypeReference<Uint256>() {},
        new TypeReference<Bytes32>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint64>() {},
        new TypeReference<Uint8>() {},
        new TypeReference<Bool>() {}
    );

    private SafeDealContractCodec() {
    }

    public static Function encodeGetTradeFunction(String tradeIdHex) {
        byte[] bytes32 = Numeric.hexStringToByteArray(tradeIdHex);
        return new Function("getTrade", List.of(new Bytes32(bytes32)), GET_TRADE_OUTPUTS);
    }

    public static String encodeGetTradeCallData(String tradeIdHex) {
        return FunctionEncoder.encode(encodeGetTradeFunction(tradeIdHex));
    }

    @SuppressWarnings("rawtypes")
    public static Optional<OnChainTradeSnapshot> decodeGetTradeResponse(String rawHex) {
        if (rawHex == null || rawHex.isBlank() || "0x".equalsIgnoreCase(rawHex)) {
            return Optional.empty();
        }
        List<Type> decoded = FunctionReturnDecoder.decode(rawHex, org.web3j.abi.Utils.convert(GET_TRADE_OUTPUTS));
        if (decoded.size() < 14) {
            return Optional.empty();
        }
        int statusOrdinal = ((Uint8) decoded.get(12)).getValue().intValue();
        if (statusOrdinal == 0) {
            return Optional.empty();
        }
        return Optional.of(new OnChainTradeSnapshot(
            toHex32(((Bytes32) decoded.get(0)).getValue()),
            ((Address) decoded.get(1)).getValue().toLowerCase(),
            ((Address) decoded.get(2)).getValue().toLowerCase(),
            ((Address) decoded.get(3)).getValue().toLowerCase(),
            ((Uint256) decoded.get(4)).getValue().toString(),
            toHex32(((Bytes32) decoded.get(5)).getValue()),
            ((Uint64) decoded.get(9)).getValue().longValue(),
            ((Uint64) decoded.get(10)).getValue().longValue(),
            ((Uint64) decoded.get(11)).getValue().longValue(),
            ((Uint64) decoded.get(8)).getValue().longValue(),
            statusOrdinal,
            ((Bool) decoded.get(13)).getValue(),
            "0",
            "0"
        ));
    }

    @SuppressWarnings("rawtypes")
    public static Optional<VerifiedChainEvent> decodeLog(Log ethLog, long blockTimestampEpoch) {
        List<String> topics = ethLog.getTopics();
        if (topics == null || topics.isEmpty()) {
            return Optional.empty();
        }
        String sig = topics.get(0);
        String txHash = ethLog.getTransactionHash().toLowerCase();
        int logIndex = ethLog.getLogIndex() != null ? ethLog.getLogIndex().intValue() : 0;
        long blockNumber = ethLog.getBlockNumber() != null ? ethLog.getBlockNumber().longValue() : 0L;
        String contractAddress = ethLog.getAddress().toLowerCase();

        if (SIG_TRADE_CREATED.equalsIgnoreCase(sig) && topics.size() >= 4) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String seller = decodeTopicAddress(topics.get(2));
            String preassignedBuyer = decodeTopicAddress(topics.get(3));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), TRADE_CREATED.getNonIndexedParameters());
            String amountWei = ((Uint256) data.get(1)).getValue().toString();
            String termsHash = toHex32(((Bytes32) data.get(2)).getValue());
            String buyerOrNull = "0x0000000000000000000000000000000000000000".equals(preassignedBuyer)
                ? null
                : preassignedBuyer;
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.TRADE_CREATED, tradeId, seller, buyerOrNull, amountWei, null, null, termsHash
            ));
        }

        if (SIG_TRADE_FUNDED.equalsIgnoreCase(sig) && topics.size() >= 3) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String buyer = decodeTopicAddress(topics.get(2));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), TRADE_FUNDED.getNonIndexedParameters());
            String amountWei = ((Uint256) data.get(0)).getValue().toString();
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.TRADE_FUNDED, tradeId, buyer, buyer, amountWei, null, null, null
            ));
        }

        if (SIG_DELIVERY_MARKED.equalsIgnoreCase(sig) && topics.size() >= 3) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String seller = decodeTopicAddress(topics.get(2));
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.DELIVERY_MARKED, tradeId, seller, null, null, null, null, null
            ));
        }

        if (SIG_FUNDS_RELEASED.equalsIgnoreCase(sig) && topics.size() >= 3) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String seller = decodeTopicAddress(topics.get(2));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), FUNDS_RELEASED.getNonIndexedParameters());
            String amountWei = ((Uint256) data.get(0)).getValue().toString();
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.FUNDS_RELEASED, tradeId, seller, null, amountWei, null, null, null
            ));
        }

        if (SIG_REFUND_EXECUTED.equalsIgnoreCase(sig) && topics.size() >= 4) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String buyer = decodeTopicAddress(topics.get(2));
            String initiatedBy = decodeTopicAddress(topics.get(3));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), REFUND_EXECUTED.getNonIndexedParameters());
            String amountWei = ((Uint256) data.get(0)).getValue().toString();
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.REFUND_EXECUTED, tradeId, initiatedBy, buyer, amountWei, null, null, null
            ));
        }

        if (SIG_DISPUTE_OPENED.equalsIgnoreCase(sig) && topics.size() >= 3) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String openedBy = decodeTopicAddress(topics.get(2));
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.DISPUTE_OPENED, tradeId, openedBy, null, null, null, null, null
            ));
        }

        if (SIG_DISPUTE_RESOLVED.equalsIgnoreCase(sig) && topics.size() >= 4) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String arbiter = decodeTopicAddress(topics.get(2));
            String buyer = decodeTopicAddress(topics.get(3));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), DISPUTE_RESOLVED.getNonIndexedParameters());
            BigInteger buyerAmount = ((Uint256) data.get(0)).getValue();
            BigInteger sellerAmount = ((Uint256) data.get(2)).getValue();
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.DISPUTE_RESOLVED, tradeId, arbiter, buyer, null,
                buyerAmount.toString(), sellerAmount.toString(), null
            ));
        }

        if (SIG_FUNDS_WITHDRAWN.equalsIgnoreCase(sig) && topics.size() >= 2) {
            String beneficiary = decodeTopicAddress(topics.get(1));
            List<Type> data = FunctionReturnDecoder.decode(ethLog.getData(), FUNDS_WITHDRAWN.getNonIndexedParameters());
            String amountWei = ((Uint256) data.get(0)).getValue().toString();
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.FUNDS_WITHDRAWN, null, beneficiary, null, amountWei, null, null, null
            ));
        }

        if (SIG_TRADE_CANCELLED.equalsIgnoreCase(sig) && topics.size() >= 3) {
            String tradeId = decodeTopicBytes32(topics.get(1));
            String cancelledBy = decodeTopicAddress(topics.get(2));
            return Optional.of(new VerifiedChainEvent(
                txHash, logIndex, blockNumber, blockTimestampEpoch, contractAddress,
                OnChainEventType.TRADE_CANCELLED, tradeId, cancelledBy, null, null, null, null, null
            ));
        }

        return Optional.empty();
    }

    private static String decodeTopicBytes32(String topicHex) {
        Bytes32 b = (Bytes32) FunctionReturnDecoder.decodeIndexedValue(topicHex, new TypeReference<Bytes32>() {});
        return toHex32(b.getValue());
    }

    private static String decodeTopicAddress(String topicHex) {
        Address addr = (Address) FunctionReturnDecoder.decodeIndexedValue(topicHex, new TypeReference<Address>() {});
        return addr.getValue().toLowerCase();
    }

    private static String toHex32(byte[] raw) {
        String hex = Numeric.toHexStringNoPrefix(raw);
        if (hex.length() < 64) {
            hex = "0".repeat(64 - hex.length()) + hex;
        }
        return "0x" + hex.toLowerCase();
    }
}
