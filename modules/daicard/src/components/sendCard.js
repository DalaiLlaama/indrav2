import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  InputAdornment,
  Modal,
  TextField,
  Tooltip,
  Typography,
  withStyles,
} from "@material-ui/core";
import { Send as SendIcon, Link as LinkIcon } from "@material-ui/icons";
import { useMachine } from '@xstate/react';
import { Zero } from "ethers/constants";
import { hexlify, randomBytes } from "ethers/utils";
import QRIcon from "mdi-material-ui/QrcodeScan";
import React, { useCallback, useEffect, useState } from "react";
import queryString from "query-string";
import { Machine } from 'xstate';

import { Currency, toBN, delay } from "../utils";

import { Copyable } from "./copyable";
import { QRScan } from "./qrCode";

const LINK_LIMIT = Currency.DAI("10"); // $10 capped linked payments

const style = withStyles((theme) => ({
  modalContent: {
    margin: "0% 4% 4% 4%",
    padding: "0px",
    width: "92%",
  },
  icon: {
    width: "40px",
    height: "40px",
  },
  input: {
    width: "100%",
  },
  button: {
    backgroundColor: "#FCA311",
    color: "#FFF",
  },
}));

const PaymentStateMachine = Machine({
  id: 'payment',
  initial: 'idle',
  states: {
    'idle': { on: {
      'NEW_P2P': 'processingP2p',
      'NEW_LINK': 'processingLink',
      'ERROR': 'error',
    }},
    'processingP2p': { on: {
      'DONE': 'successP2p',
      'ERROR': 'error',
    }},
    'processingLink': { on: {
      'DONE': 'successLink',
      'ERROR': 'error',
    }},
    'successP2p': { on: {
      'DISMISS': 'idle'
    }},
    'successLink': { on: {
      'DISMISS': 'idle'
    }},
    'error': { on: {
      'DISMISS': 'idle'
    }},
  }
});

export const SendCard = style(({ balance, channel, classes, history, location, token  }) => {
  const [amount, setAmount] = useState({ display: "", error: null, value: null });
  const [link, setLink] = useState(undefined);
  const [paymentState, paymentAction] = useMachine(PaymentStateMachine);
  const [recipient, setRecipient] = useState({ display: "", error: null, value: null });
  const [scan, setScan] = useState(false);

  const updateAmountHandler = useCallback((rawValue) => {
    let value = null;
    let error = null;
    try {
      value = Currency.DAI(rawValue);
    } catch (e) {
      error = e.message;
    }
    if (value && value.wad.gt(balance.channel.token.wad)) {
      error = `Invalid amount: must be less than your balance`;
    }
    if (value && value.wad.lte(Zero)) {
      error = "Invalid amount: must be greater than 0";
    }
    setAmount({
      display: rawValue,
      error,
      value: error ? null : value,
    });
  }, [balance])

  const updateRecipientHandler = (rawValue) => {
    const xpubLen = 111;
    let value = null;
    let error = null;
    value = rawValue;
    if (!value.startsWith("xpub")) {
      error = "Invalid recipient: should start with xpub";
    }
    if (!error && value.length !== xpubLen) {
      error = `Invalid recipient: expected ${xpubLen} characters, got ${value.length}`;
    }
    setRecipient({
      display: rawValue,
      error,
      value: error ? null : value,
    });
  }

  const handleQRData = (scanResult) => {
    let data = scanResult.split("/send?");
    if (data[0] === window.location.origin) {
      const query = queryString.parse(data[1]);
      if (query.amountToken) {
        updateAmountHandler(query.amountToken);
      }
      if (query.recipient) {
        updateRecipientHandler(query.recipient);
      }
    } else {
      console.warn(`QR Code was generated by incorrect site: ${data[0]}`);
    }
    setScan(false);
  };

  const paymentHandler = async () => {
    if (amount.error || recipient.error) return;
    console.log(`Sending ${amount.value} to ${recipient.value}`);
    paymentAction('NEW_P2P');
    // there is a chance the payment will fail when it is first sent
    // due to lack of collateral. collateral will be auto-triggered on the
    // hub side. retry for 1min, then fail
    const endingTs = Date.now() + 60 * 1000;
    let transferRes = undefined;
    while (Date.now() < endingTs) {
      try {
        transferRes = await channel.transfer({
          assetId: token.address,
          amount: amount.value.wad.toString(),
          recipient: recipient.value,
        });
        break;
      } catch (e) {
        await delay(5000);
      }
    }
    if (!transferRes) {
      paymentAction('ERROR');
      return;
    }
    paymentAction('DONE');
  }

  const linkHandler = async () => {
    if (amount.error || recipient.error) return;
    if (toBN(amount.value.toDEI()).gt(LINK_LIMIT.wad)) {
      setAmount({ ...amount, error: `Linked payments are capped at ${LINK_LIMIT.format()}.` });
      return;
    }
    paymentAction('NEW_LINK');
    try {
      console.log(`Creating ${amount.value.format()} link payment`);
      const link = await channel.conditionalTransfer({
        assetId: token.address,
        amount: amount.value.wad.toString(),
        conditionType: "LINKED_TRANSFER",
        paymentId: hexlify(randomBytes(32)),
        preImage: hexlify(randomBytes(32)),
      });
      console.log(`Created link payment: ${JSON.stringify(link, null, 2)}`);
      console.log(
        `link params: secret=${link.preImage}&paymentId=${link.paymentId}&` +
          `assetId=${token.address}&amount=${amount.value.amount}`,
      );
      paymentAction('DONE');
      setLink({
        baseUrl: `${window.location.origin}/redeem`,
        paymentId: link.paymentId,
        secret: link.preImage,
      });
    } catch (e) {
      console.warn("Unexpected error creating link payment:", e);
      paymentAction('ERROR');
    }
  }

  const closeModal = () => {
    paymentAction('DISMISS');
  };

  useEffect(() => {
    const query = queryString.parse(location.search);
    if (query.amountToken) {
      updateAmountHandler(query.amountToken);
    }
    if (query.recipient) {
      updateRecipientHandler(query.recipient);
    }
  }, [location, updateAmountHandler])

  return (
    <Grid
      container
      spacing={2}
      direction="column"
      style={{
        display: "flex",
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: "10%",
        paddingBottom: "10%",
        textAlign: "center",
        justify: "center",
      }}
    >
      <Grid container wrap="nowrap" direction="row" justify="center" alignItems="center">
        <Grid item xs={12}>
          <SendIcon className={classes.icon} />
        </Grid>
      </Grid>
      <Grid item xs={12}>
        <Grid container direction="row" justify="center" alignItems="center">
          <Typography variant="h2">
            <span>{balance.channel.token.toDAI().format()}</span>
          </Typography>
        </Grid>
      </Grid>
      <Grid item xs={12}>
        <Typography variant="body2">
          <span>{`Linked payments are capped at ${LINK_LIMIT.format()}.`}</span>
        </Typography>
      </Grid>
      <Grid item xs={12}>
        <TextField
          fullWidth
          id="outlined-number"
          label="Amount"
          value={amount.display}
          type="number"
          margin="normal"
          variant="outlined"
          onChange={evt => updateAmountHandler(evt.target.value)}
          error={amount.error !== null}
          helperText={amount.error}
        />
      </Grid>
      <Grid item xs={12}>
        <TextField
          style={{ width: "100%" }}
          id="outlined"
          label="Recipient Address"
          type="string"
          value={recipient.display}
          onChange={evt => updateRecipientHandler(evt.target.value)}
          margin="normal"
          variant="outlined"
          helperText={recipient.error ? recipient.error : "Ignored for linked payments"}
          error={recipient.error !== null}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip disableFocusListener disableTouchListener title="Scan with QR code">
                  <Button
                    variant="contained"
                    color="primary"
                    style={{ color: "#FFF" }}
                    onClick={() => setScan(true)}
                  >
                    <QRIcon />
                  </Button>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
      </Grid>
      <Modal
        id="qrscan"
        open={scan}
        onClose={() => setScan(false)}
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          position: "absolute",
          top: "10%",
          width: "375px",
          marginLeft: "auto",
          marginRight: "auto",
          left: "0",
          right: "0",
        }}
      >
        <QRScan handleResult={handleQRData} history={history} />
      </Modal>
      <Grid item xs={12}>
        <Grid container direction="row" alignItems="center" justify="center" spacing={8}>
          <Grid item xs={6}>
            <Button
              className={classes.button}
              disabled={!!amount.error || !!recipient.error}
              fullWidth
              onClick={() => {
                linkHandler();
              }}
              size="large"
              variant="contained"
            >
              Link
              <LinkIcon style={{ marginLeft: "5px" }} />
            </Button>
          </Grid>
          <Grid item xs={6}>
            <Button
              className={classes.button}
              disabled={
                !!amount.error ||
                !!recipient.error ||
                paymentState === 'processingP2p' ||
                paymentState === 'processingLink'
              }
              fullWidth
              onClick={() => {
                paymentHandler();
              }}
              size="large"
              variant="contained"
            >
              Send
              <SendIcon style={{ marginLeft: "5px" }} />
            </Button>
          </Grid>
        </Grid>
      </Grid>
      <Grid item xs={12}>
        <Button
          variant="outlined"
          style={{
            background: "#FFF",
            border: "1px solid #F22424",
            color: "#F22424",
            width: "15%",
          }}
          size="medium"
          onClick={() => history.push("/")}
        >
          Back
        </Button>
      </Grid>
      <SendCardModal
        amountToken={amount.display ? amount.display : "0"}
        classes={classes}
        closeModal={closeModal}
        history={history}
        link={link}
        paymentState={paymentState}
        recipient={recipient.value}
      />
    </Grid>
  );
})

const SendCardModal = ({
  amountToken,
  classes,
  closeModal,
  history,
  link,
  paymentState,
  recipient,
}) => (
  <Dialog
    open={!paymentState.matches('idle')}
    onBackdropClick={
      (paymentState === 'processingP2p' || paymentState === 'processingLink')
        ? null
        : () => closeModal()
    }
    fullWidth
    style={{
      justifyContent: "center",
      alignItems: "center",
      textAlign: "center",
    }}
  >
    <Grid
      container
      style={{
        backgroundColor: "#FFF",
        paddingTop: "10%",
        paddingBottom: "10%",
      }}
      justify="center"
    >

      {paymentState.matches('processingP2p') ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" color="primary">
              Payment In Progress
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" style={{ color: "#0F1012", margin: "1em" }}>
              Recipient's Card is being set up. This should take 20-30 seconds.
            </DialogContentText>
            <DialogContentText variant="body1" style={{ color: "#0F1012" }}>
              If you stay on this page, your payment will be retried automatically. If you navigate
              away or refresh the page, you will have to attempt the payment again yourself.
            </DialogContentText>
            <CircularProgress style={{ marginTop: "1em" }} />
          </DialogContent>
        </Grid>

      ) : paymentState.matches('processingLink') ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" color="primary">
              Payment In Progress
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" style={{ color: "#0F1012", margin: "1em" }}>
              Link payment is being generated. This should take just a couple seconds.
            </DialogContentText>
            <DialogContentText variant="body1" style={{ color: "#0F1012" }}>
              Payment ID: {'0xabc123...'}
            </DialogContentText>
            <CircularProgress style={{ marginTop: "1em" }} />
          </DialogContent>
        </Grid>

      ) : paymentState.matches('successP2p') ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#009247" }}>
              Payment Success!
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" style={{ color: "#0F1012", margin: "1em" }}>
              Amount: ${amountToken}
            </DialogContentText>
            <DialogContentText variant="body1" style={{ color: "#0F1012" }}>
              To: {recipient.substr(0, 5)}...
            </DialogContentText>
          </DialogContent>
        </Grid>

      ) : paymentState.matches('successLink') ? (
        <div style={{ width: "100%" }}>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#009247" }}>
              Payment Link Created!
            </Typography>
          </DialogTitle>
          <DialogContent className={classes.modalContent}>
            <DialogContentText variant="body1" style={{ color: "#0F1012", margin: "1em" }}>
              Anyone with this link can redeem the payment. Save a copy of it somewhere safe and only share it with the person you want to pay.
            </DialogContentText>
            <Copyable
              text={link
                ? `${link.baseUrl}?paymentId=${link.paymentId}&secret=${link.secret}`
                : '???'}
            />
          </DialogContent>
        </div>

        ) : paymentState.matches('error') ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#F22424" }}>
              Payment Failed
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" style={{ color: "#0F1012", margin: "1em" }}>
              An unknown error occured when making your payment.
            </DialogContentText>
            <DialogContentText variant="body1" style={{ color: "#0F1012" }}>
              Please try again in 30s and contact support if you continue to experience issues.
              (Settings --> Support)
            </DialogContentText>
          </DialogContent>
        </Grid>

      ) : (
        <div/>
      )}

      {(paymentState === 'processingP2p' || paymentState === 'processingLink') ? (
        <div/>
      ) : (
        <DialogActions>
          <Button
            color="primary"
            variant="outlined"
            size="medium"
            onClick={() => closeModal()}
          >
            Close
          </Button>
          <Button
            style={{
              background: "#FFF",
              border: "1px solid #F22424",
              color: "#F22424",
              marginLeft: "5%",
            }}
            variant="outlined"
            size="medium"
            onClick={() => history.push("/")}
          >
            Home
          </Button>
        </DialogActions>
      )}
    </Grid>
  </Dialog>
);
