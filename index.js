const functions = require("firebase-functions");
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
admin.initializeApp();

const authorization = "Basic ВАШ ТОКЕН";
const initial_payment_msg = "Списываем оплату за заказ";
const my_url = "https://www.instagram.com/sprestay/";

exports.initialPayment = functions.https.onRequest(async (request, response) => {
    try {
        const url = "https://api.yookassa.ru/v3/payments";

        // получаем заказ из БД и цену заказа
        var order_id = request.body.order_id;
        const orders = admin.firestore().collection('orders');
        var order_snapshot = await orders.doc(order_id).get();
        var order = order_snapshot.data();
        var price = order['price'];

        // параметры для запроса
        var headers = {
            "Authorization": authorization,
            "Idempotence-Key": uuidv4().toString(),
            "Content-Type": 'application/json'
        };
        var params = {
            "amount": {
                "value": price.toString(),
                "currency": "RUB"
            },
            "payment_method_data": {
                "type": "bank_card"
            },
            "confirmation": {
                "type": "redirect",
                "return_url": my_url
            },
            "description": initial_payment_msg,
            "save_payment_method": "false"
        };

        // запрос к юкассе
        axios.post(url, params, {
            headers: headers,
        }).then((res) => {
            return res.data;
        })
            .then(async (res) => {
                if (res.status == "pending") {
                    await orders.doc(order_id).update({"payment_id": res.payment_method.id});
                    response.send({
                        "url": res.confirmation.confirmation_url, 
                    });
                }
            })
            .catch((err) => {
                functions.logger.log("ERROR", err);
                response.send({
                    "status": "error",
                    "body": err,
                });
            });
    } catch (e) {
        functions.logger.log("ERROR");
        functions.logger.log(e.message);
        response.send({
            "status": "error",
            "body": e.message
        });
    }
});


exports.UkassaWebHook = functions.https.onRequest(async (request, response) => {
    if (request.body.event == "payment.waiting_for_capture") {
        let payment_id = request.body.object.id;
        let status = request.body.object.status;
        if (status == "waiting_for_capture") {
            // сюда попадаем, если клиент оплатил
            await confirmPayment(payment_id);
            await getPayment(payment_id);
        }
    }
    response.send("OK");
});




const confirmPayment = async (payment_id) => {
    await admin.firestore().collection('orders').where("payment_id", "==", payment_id)
    .limit(1)
    .get()
    .then(snapshot => {
        if (snapshot.size > 0) {
            const firstDoc = snapshot.docs[0].ref;
            firstDoc.update({paid: true}).then(() => {
                console.log('Документ успешно обновлен');
              })
              .catch(err => {
                console.log('Ошибка обновления документа', err);
              });
          } else {
            console.log("документы не найдены");
          }
    })
    .catch(err => {
        console.log('Ошибка получения документа', err);
        return null
    });
}

const getPayment = async (payment_id) => {
    const url = `https://api.yookassa.ru/v3/payments/${payment_id}/capture`;

    var headers = {
        "Authorization": authorization,
        "Idempotence-Key": uuidv4().toString(),
        "Content-Type": 'application/json'
    };

    return await axios.post(url, {}, {
        headers: headers,
    }).then((res) => res.data).then(async (res) => {
        functions.logger.log("Платеж успешно подтвержден", res);
        return true;
    }).catch((err) => {
        functions.logger.log("Ошибка при подтверждении платежа", err);
        return false;
    });
}

const cancelPayemnt = async (payment_id) => {
    const url = `https://api.yookassa.ru/v3/payments/${payment_id}/cancel`;

    var headers = {
        "Authorization": authorization,
        "Idempotence-Key": uuidv4().toString(),
        "Content-Type": 'application/json'
    };

    return await axios.post(url, {}, {
        headers: headers,
    }).then((res) => res.data).then(async (res) => {
        functions.logger.log("Платеж успешно отменен", res);
        return true;
    }).catch((err) => {
        functions.logger.log("Ошибка при отмене платежа", err);
        return false;
    });
}

exports.getPaymentApi = functions.https.onRequest(async (request, response) => {
    var payment_id = request.body.payment_id;
    await getPayment(payment_id);
    response.status(200);
});

exports.cancelPaymentApi = functions.https.onRequest(async (request, response) => {
    var payment_id = request.body.payment_id;
    await cancelPayemnt(payment_id);
    response.status(200);
})