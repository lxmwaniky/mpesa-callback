const DatabaseService = require('./database.service');

class MpesaService {
    constructor() {
        this.databaseService = new DatabaseService();
    }

    parseCallbackData(requestBody) {
        const { Body } = requestBody;
        
        if (!Body?.stkCallback) {
            throw new Error('Invalid callback data: Missing stkCallback');
        }

        return Body.stkCallback;
    }

    extractTransactionData(callbackData) {
        const { 
            MerchantRequestID, 
            CheckoutRequestID, 
            ResultCode, 
            ResultDesc, 
            CallbackMetadata 
        } = callbackData;

        const transaction = {
            merchantRequestID: MerchantRequestID,
            checkoutRequestID: CheckoutRequestID,
            resultCode: ResultCode,
            resultDesc: ResultDesc,
            status: this.mapResultCodeToStatus(ResultCode)
        };

        if (ResultCode === 0 && CallbackMetadata?.Item) {
            const metadata = this.parseCallbackMetadata(CallbackMetadata.Item);
            Object.assign(transaction, metadata);
        }

        return transaction;
    }

    parseCallbackMetadata(items) {
        const metadata = {};
        
        items.forEach(item => {
            switch (item.Name) {
                case 'Amount':
                    metadata.amount = item.Value;
                    break;
                case 'MpesaReceiptNumber':
                    metadata.receiptNumber = item.Value;
                    break;
                case 'TransactionDate':
                    metadata.transactionDate = item.Value;
                    break;
                case 'PhoneNumber':
                    metadata.phoneNumber = item.Value;
                    break;
                case 'Balance':
                    metadata.balance = item.Value;
                    break;
                default:
                    metadata[item.Name] = item.Value;
            }
        });

        return metadata;
    }

    mapResultCodeToStatus(resultCode) {
        const statusMap = {
            0: 'success',
            1: 'insufficient_funds',
            1037: 'timeout',
            1032: 'cancelled',
            1: 'failed'
        };

        return statusMap[resultCode] || 'failed';
    }

    async processCallback(requestBody) {
        try {
            await this.databaseService.logCallback(requestBody, 'received');

            const callbackData = this.parseCallbackData(requestBody);
            const transactionData = this.extractTransactionData(callbackData);

            const existing = await this.databaseService.getTransaction(
                transactionData.checkoutRequestID
            );

            let result;
            if (existing) {
                result = await this.databaseService.updateTransaction(
                    transactionData.checkoutRequestID,
                    transactionData
                );
            } else {
                result = await this.databaseService.saveTransaction(transactionData);
            }

            await this.databaseService.logCallback(requestBody, 'processed');

            return {
                success: true,
                transactionId: transactionData.checkoutRequestID,
                status: transactionData.status,
                message: 'Transaction processed successfully'
            };

        } catch (error) {
            await this.databaseService.logCallback(requestBody, 'failed');
            throw error;
        }
    }

    async getTransactionStatus(checkoutRequestID) {
        const transaction = await this.databaseService.getTransaction(checkoutRequestID);
        
        if (!transaction) {
            return { found: false, message: 'Transaction not found' };
        }

        return {
            found: true,
            status: transaction.status,
            resultCode: transaction.resultCode,
            amount: transaction.amount,
            receiptNumber: transaction.receiptNumber,
            phoneNumber: transaction.phoneNumber,
            timestamp: transaction.timestamp
        };
    }

    async getTransactionHistory(phoneNumber, limit = 10) {
        return await this.databaseService.getTransactionsByPhone(phoneNumber, limit);
    }
}

module.exports = MpesaService;
