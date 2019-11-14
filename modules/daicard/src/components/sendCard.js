import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputBase,
  Grid,
  IconButton,
  Modal,
  Tooltip,
  Typography,
  withStyles,
} from "@material-ui/core";
import PropTypes from "prop-types";
import { Send as SendIcon, Link as LinkIcon } from "@material-ui/icons";
import { useMachine } from "@xstate/react";
import { Zero } from "ethers/constants";
import { hexlify, randomBytes } from "ethers/utils";
import QRIcon from "mdi-material-ui/QrcodeScan";
import React, { useCallback, useEffect, useState } from "react";
import queryString from "query-string";

import { Currency, toBN } from "../utils";
import { sendMachine } from "../state";

import Copyable from "./copyable";
import { QRScan } from "./qrCode";

const LINK_LIMIT = Currency.DAI("10"); // $10 capped linked payments

const formatAmountString = amount => {
  const [whole, part] = amount.split(".");
  return `${whole || "0"}.${part ? part.padEnd(2, "0") : "00"}`;
};

const styles = {
  modalContent: {
    margin: "0% 4% 4% 4%",
    padding: "0px",
    width: "92%",
  },
  modal: {
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    position: "absolute",
    top: "10%",
    width: "320px",
    marginLeft: "auto",
    marginRight: "auto",
    left: "0",
    right: "0",
  },
  icon: {
    color: "#fca311",
    width: "40px",
    height: "40px",
  },
  input: {
    width: "100%",
  },

  top: {
    display: "flex",
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: "10%",
    paddingBottom: "10%",
    textAlign: "center",
    justify: "center",
  },
  valueInput: {
    color: "#FCA311",
    fontSize: "60px",
    cursor: "none",
    overflow: "hidden",
    width: "100%",
  },
  valueInputInner: {
    textAlign: "center",
    margin: "auto",
  },
  helperText: {
    color: "red",
    marginTop: "-5px",
    alignSelf: "center",
    textAlign: "center",
  },
  helperTextGray: {
    color: "#1E96CC",
    marginTop: "-5px",
    alignSelf: "center",
    textAlign: "center",
  },
  xpubWrapper: {
    marginLeft: "5%",
    marginRight: "5%",
  },
  xpubInput: {
    width: "100%",
    color: "#FCA311",
    fontSize: "45px",
  },
  xpubInputInner: {
    textAlign: "center",
    margin: "auto",
  },
  QRbutton: {
    color: "#fca311",
  },
  linkSendWrapper: {
    justifyContent: "space-between",
  },
  buttonSpacer: {
    height: "10px",
    width: "100%",
  },
  button: {
    color: "#FFF",
    width: "48%",
  },
  buttonIcon: {
    marginLeft: "5px",
  },
  linkButtonInner: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "5px",
  },
  linkSub: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: "-5px",
    width: "100%",
  },
  sendCardModalWrap: {
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
  },
  sendCardModalGrid: { backgroundColor: "#FFF", paddingTop: "10%", paddingBottom: "10%" },
  dialogText:{
    color: "#FCA311", margin: "1em"
  },
  dialogTextRed:{
    color: "#F22424", margin: "1em"
  }
};

const SendCard = props => {
  const { match, balance, channel, classes, history, location, token } = props;
  const [amount, setAmount] = useState({
    display: match.params.amount ? match.params.amount : "0.00",
    error: null,
    value: null,
  });
  const [link, setLink] = useState(undefined);
  const [paymentState, paymentAction] = useMachine(sendMachine);
  const [recipient, setRecipient] = useState({
    display: match.params.recipient ? match.params.recipient : "",
    error: null,
    value: null,
  });
  const [scan, setScan] = useState(false);

  useEffect(() => {
    amount.display && updateAmountHandler(amount.display);
    recipient.display && updateRecipientHandler(recipient.display);
    // Only need to run this on first render to deal w query string values
    // onChange handlers take care of this afterwards so we don't need this function to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // need to extract token balance so it can be used as a dependency for the hook properly

  const tokenBalance = balance.channel.token.wad;

  const updateAmountHandler = useCallback(
    rawValue => {
      let value = null;
      let error = null;
      if (!rawValue) {
        error = `Invalid amount: must be greater than 0`;
      }
      if (!error) {
        try {
          value = Currency.DAI(rawValue);
        } catch (e) {
          error = `Please enter a valid amount`;
        }
      }
      if (!error && value && tokenBalance && value.wad.gt(tokenBalance)) {
        error = `Invalid amount: must be less than your balance`;
      }
      if (!error && value && value.wad.lte(Zero)) {
        error = "Invalid amount: must be greater than 0";
      }
      setAmount({
        display: rawValue,
        error,
        value: error ? null : value,
      });
    },
    [tokenBalance],
  );

  const updateRecipientHandler = rawValue => {
    const xpubLen = 111;
    let value = null;
    let error = null;
    value = rawValue;
    if (!value || !value.startsWith("xpub")) {
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
  };

  const handleQRData = scanResult => {
    let data = scanResult.split("/send?");
    if (data[0] === window.location.origin) {
      const query = queryString.parse(data[1]);
      if (query.amount) {
        updateAmountHandler(query.amount);
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
    if (!channel || !token || amount.error || recipient.error) return;
    if (!recipient.value) {
      setRecipient({
        ...recipient,
        error: "Recipent must be specified for p2p transfer",
      });
      return;
    }
    console.log(`Sending ${amount.value} to ${recipient.value}`);
    paymentAction("NEW_P2P");
    // there is a chance the payment will fail when it is first sent
    // due to lack of collateral. collateral will be auto-triggered on the
    // hub side. retry for 1min, then fail
    const endingTs = Date.now() + 60 * 1000;
    let transferRes = undefined;
    while (Date.now() < endingTs) {
      try {
        transferRes = await channel.conditionalTransfer({
          assetId: token.address,
          amount: amount.value.wad.toString(),
          conditionType: "LINKED_TRANSFER_TO_RECIPIENT",
          paymentId: hexlify(randomBytes(32)),
          preImage: hexlify(randomBytes(32)),
          recipient: recipient.value,
        });
        break;
      } catch (e) {
        await new Promise(res => setTimeout(res, 5000));
      }
    }
    if (!transferRes) {
      paymentAction("ERROR");
      return;
    }
    paymentAction("DONE");
  };

  const linkHandler = async () => {
    if (!channel || !token || amount.error) return;
    if (recipient.error && !recipient.value) {
      setRecipient({ ...recipient, error: null });
    }
    if (toBN(amount.value.toDEI()).gt(LINK_LIMIT.wad)) {
      setAmount({ ...amount, error: `Linked payments are capped at ${LINK_LIMIT.format()}.` });
      return;
    }
    paymentAction("NEW_LINK");
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
      paymentAction("DONE");
      setLink({
        baseUrl: `${window.location.origin}/redeem`,
        paymentId: link.paymentId,
        secret: link.preImage,
      });
    } catch (e) {
      console.warn("Unexpected error creating link payment:", e);
      paymentAction("ERROR");
    }
  };

  const closeModal = () => {
    paymentAction("DISMISS");
  };

  useEffect(() => {
    const query = queryString.parse(location.search);
    if (!amount.value && query.amount) {
      updateAmountHandler(query.amount);
    }
    if (!recipient.value && !recipient.error && query.recipient) {
      updateRecipientHandler(query.recipient);
    }
  }, [location, updateAmountHandler, amount.value, recipient.value, recipient.error]);

  return (
    <Grid className={classes.top} container spacing={2} direction="column">
      <FormControl xs={12} className={classes.bodyForm}>
        <InputBase
          required
          className={classes.valueInput}
          classes={{ input: classes.valueInputInner }}
          onChange={evt => updateAmountHandler(evt.target.value.replace("$",""))}
          type="numeric"
          value={amount.display === "" ? null : "$"+amount.display}
          placeholder={"0.00"}
        />
        {amount.error && (
          <FormHelperText className={classes.helperText}>{amount.error}</FormHelperText>
        )}
      </FormControl>

      <FormControl xs={12} className={classes.xpubWrapper}>
        <InputBase
          fullWidth
          className={classes.xpubInput}
          classes={{ input: classes.xpubInputInner }}
          onChange={evt => updateRecipientHandler(evt.target.value)}
          type="text"
          value={recipient.display}
          placeholder={"Recipient"}
          endAdornment={
            <Tooltip disableFocusListener disableTouchListener title="Scan with QR code">
              <IconButton
                className={classes.QRButton}
                disableTouchRipple
                variant="contained"
                onClick={() => setScan(true)}
              >
                <QRIcon className={classes.icon} />
              </IconButton>
            </Tooltip>
          }
        />
        <FormHelperText className={recipient.error ? classes.helperText : classes.helperTextGray}>
          {recipient.error ? recipient.error : "Recipient ignored for link payments"}
        </FormHelperText>
      </FormControl>
      <Grid className={classes.buttonSpacer} />
      <Grid className={classes.buttonSpacer} />
      <Grid container direction="row" className={classes.linkSendWrapper}>
        <Button
          className={classes.button}
          disableTouchRipple
          disabled={!!amount.error}
          color="primary"
          variant="contained"
          size="large"
          onClick={() => {
            linkHandler();
          }}
        >
          <Grid container direction="row" className={classes.linkButtonInner}>
            <Typography>Link</Typography>
            <LinkIcon className={classes.buttonIcon} />
            <Typography className={classes.linkSub}>
              <span>{`${LINK_LIMIT.format()} Max`}</span>
            </Typography>
          </Grid>
        </Button>
        <Button
          className={classes.button}
          disableTouchRipple
          color="primary"
          size="large"
          variant="contained"
          disabled={
            !!amount.error ||
            !!recipient.error ||
            paymentState === "processingP2p" ||
            paymentState === "processingLink"
          }
          onClick={() => {
            paymentHandler();
          }}
        >
          Send
          <SendIcon className={classes.buttonIcon} />
        </Button>
      </Grid>

      {/* <Grid item xs={12}>
        <Button
          disableTouchRipple
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
      </Grid> */}

      <Modal id="qrscan" open={scan} onClose={() => setScan(false)} className={classes.modal}>
        <QRScan handleResult={handleQRData} history={history} />
      </Modal>

      <SendCardModal
        amount={amount.display ? amount.display : "0"}
        classes={classes}
        closeModal={closeModal}
        history={history}
        link={link}
        paymentState={paymentState}
        recipient={recipient.value}
      />
    </Grid>
  );
};

const SendCardModal = ({ amount, classes, closeModal, history, link, paymentState, recipient }) => (
  <Dialog
    open={!paymentState.matches("idle")}
    onBackdropClick={
      paymentState === "processingP2p" || paymentState === "processingLink"
        ? null
        : () => closeModal()
    }
    fullWidth
    className={classes.sendCardModalWrap}
  >
    <Grid className={classes.sendCardModalGrid} container justify="center">
      {paymentState.matches("processingP2p") ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" color="primary">
              Payment In Progress
            </Typography>
          </DialogTitle>
          <DialogContent>
            <CircularProgress style={{ marginTop: "1em" }} />
          </DialogContent>
        </Grid>
      ) : paymentState.matches("processingLink") ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" color="primary">
              Payment In Progress
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" className={classes.dialogText}>
              Link payment is being generated. This should take just a couple seconds.
            </DialogContentText>
            <CircularProgress style={{ marginTop: "1em" }} />
          </DialogContent>
        </Grid>
      ) : paymentState.matches("successP2p") ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#009247" }}>
              Payment Success!
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" className={classes.dialogText}>
              Amount: ${formatAmountString(amount)}
            </DialogContentText>
            <DialogContentText variant="body1" className={classes.dialogText}>
              To: {recipient.substr(0, 8)}...
            </DialogContentText>
          </DialogContent>
        </Grid>
      ) : paymentState.matches("successLink") ? (
        <div style={{ width: "100%" }}>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#009247" }}>
              Payment Link Created!
            </Typography>
          </DialogTitle>
          <DialogContent className={classes.modalContent}>
            <DialogContentText className={classes.dialogText} variant="body1" style={{ }}>
              Anyone with this link can redeem the payment. Save a copy of it somewhere safe and
              only share it with the person you want to pay.
            </DialogContentText>
            <Copyable
              text={
                link ? `${link.baseUrl}?paymentId=${link.paymentId}&secret=${link.secret}` : "???"
              }
            />
          </DialogContent>
        </div>
      ) : paymentState.matches("error") ? (
        <Grid>
          <DialogTitle disableTypography>
            <Typography variant="h5" style={{ color: "#F22424" }}>
              Payment Failed
            </Typography>
          </DialogTitle>
          <DialogContent>
            <DialogContentText variant="body1" className={classes.dialogTextRed}>
              An unknown error occured when making your payment.
            </DialogContentText>
            <DialogContentText variant="body1" className={classes.dialogTextRed}>
              Please try again in 30s and contact support if you continue to experience issues.
              (Settings --> Support)
            </DialogContentText>
          </DialogContent>
        </Grid>
      ) : (
        <div />
      )}

      {paymentState === "processingP2p" || paymentState === "processingLink" ? (
        <div />
      ) : (
        <DialogActions>
          <Button
            disableTouchRipple
            color="primary"
            variant="outlined"
            size="medium"
            onClick={() => closeModal()}
          >
            Close
          </Button>
          <Button
            disableTouchRipple
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

SendCard.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(SendCard);
