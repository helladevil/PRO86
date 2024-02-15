import React, { Component } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Text,
  ImageBackground,
  Image,
  Alert,
  ToastAndroid,
  KeyboardAvoidingView
} from "react-native";
import * as Permissions from "expo-permissions";
import { BarCodeScanner } from "expo-barcode-scanner";
import db from "../config";
import firebase from "firebase";

const bgImage = require("../assets/background2.png");
const appIcon = require("../assets/appIcon.png");
const appName = require("../assets/appName.png");

export default class TransactionScreen extends Component {
  constructor(props) {
    super(props);
    this.state = {
      bookId: "",
      UserId: "",
      domState: "normal",
      hasCameraPermissions: null,
      scanned: false,
      bookName: "",
      UserName: ""
    };
  }

  getCameraPermissions = async domState => {
    const { status } = await Permissions.askAsync(Permissions.CAMERA);

    this.setState({
      /*status === "granted" es true cuando el usuario ha concedido permiso
          status === "granted" es false cuando el usuario no ha concedido permiso
        */
      hasCameraPermissions: status === "granted",
      domState: domState,
      scanned: false
    });
  };

  handleBarCodeScanned = async ({ type, data }) => {
    const { domState } = this.state;

    if (domState === "bookId") {
      this.setState({
        bookId: data,
        domState: "normal",
        scanned: true
      });
    } else if (domState === "UserId") {
      this.setState({
        UserId: data,
        domState: "normal",
        scanned: true
      });
    }
  };

  handleTransaction = async () => {
    var { bookId, UserId } = this.state;
    await this.getBookDetails(bookId);
    await this.getUserDetails(UserId);

    var transactionType = await this.checkBookAvailability(bookId);

    if (!transactionType) {
      this.setState({ bookId: "", UserId: "" });
      // Solo para usuarios Android
      // ToastAndroid.show("El libro no existe en la base de datos", ToastAndroid.SHORT);
      Alert.alert("El libro no existe en la base de datos");
    } else if (transactionType === "issue") {
      var isEligible = await this.checkUserEligibilityForBookIssue(
        UserId
      );

      if (isEligible) {
        var { bookName, UserName } = this.state;
        this.initiateBookIssue(bookId, UserId, bookName, UserName);
      }
    
      Alert.alert("Libro emitido al señor/a");
    } else {
      var isEligible = await this.checkUserEligibilityForBookReturn(
        bookId,
        UserId
      );

      if (isEligible) {
        var { bookName, UserName } = this.state;
        this.initiateBookReturn(bookId, UserId, bookName, UserName);
      }
      //  Solo para usuarios Android
      // ToastAndroid.show("Libro devuelto a la biblioteca", ToastAndroid.SHORT);
      Alert.alert("Libro devuelto a la biblioteca");
    }
  };

  getBookDetails = bookId => {
    bookId = bookId.trim();
    db.collection("books")
      .where("book_id", "==", bookId)
      .get()
      .then(snapshot => {
        snapshot.docs.map(doc => {
          this.setState({
            bookName: doc.data().book_details.book_name
          });
        });
      });
  };

  getUserDetails = UserId => {
    UserId = UserId.trim();
    db.collection("User")
      .where("User_id", "==", UserId)
      .get()
      .then(snapshot => {
        snapshot.docs.map(doc => {
          this.setState({
            UserName: doc.data().User_details.User_name
          });
        });
      });
  };

  checkBookAvailability = async bookId => {
    const bookRef = await db
      .collection("books")
      .where("book_id", "==", bookId)
      .get();

    var transactionType = "";
    if (bookRef.docs.length == 0) {
      transactionType = false;
    } else {
      bookRef.docs.map(doc => {
        //si el libro está disponible entonces el tipo de transacción será issue
        //  si no será return
        transactionType = doc.data().is_book_available ? "issue" : "return";
      });
    }

    return transactionType;
  };

  checkUserEligibilityForBookIssue = async UserId => {
    const UserRef = await db
      .collection("User")
      .where("User_id", "==", UserId)
      .get();

    var isUserEligible = "";
    if (UserRef.docs.length == 0) {
      this.setState({
        bookId: "",
        UserId: ""
      });
      isUserEligible = false;
      Alert.alert("La id del Señor/a no existe en la base de datos");
    } else {
      UserRef.docs.map(doc => {
        if (doc.data().number_of_books_issued < 2) {
          isUserEligible = true;
        } else {
          isUserEligible = false;
          Alert.alert("Usted ya tiene 2 libros");
          this.setState({
            bookId: "",
            UserId: ""
          });
        }
      });
    }

    return isUserEligible;
  };

  checkUserEligibilityForBookReturn = async (bookId, UserId) => {
    const transactionRef = await db
      .collection("transactions")
      .where("book_id", "==", bookId)
      .limit(1)
      .get();
    var isUserEligible = "";
    transactionRef.docs.map(doc => {
      var lastBookTransaction = doc.data();
      if (lastBookTransaction.User_id === UserId) {
        isUserEligible = true;
      } else {
        isUserEligible = false;
        Alert.alert("El libro no fue emitido a usted");
        this.setState({
          bookId: "",
          UserId: ""
        });
      }
    });
    return isUserEligible;
  };

  initiateBookIssue = async (bookId, UserId, bookName, UserName) => {
    //agrega una transacción
    db.collection("transactions").add({
      User_id: UserId,
      User_name: UserName,
      book_id: bookId,
      book_name: bookName,
      date: firebase.firestore.Timestamp.now().toDate(),
      transaction_type: "issue"
    });
    //cambia el estado del libro
    db.collection("books")
      .doc(bookId)
      .update({
        is_book_available: false
      });
    //cambia el número de libros emitidos al alumno
    db.collection("User")
      .doc(UserId)
      .update({
        number_of_books_issued: firebase.firestore.FieldValue.increment(1)
      });

    // actualiza el estado local
    this.setState({
      bookId: "",
      UserId: ""
    });
  };

  initiateBookReturn = async (bookId, UserId, bookName, UserName) => {
    //agrega una transacción
    db.collection("transactions").add({
      User_id:UserId,
      User_name: UserName,
      book_id: bookId,
      book_name: bookName,
      date: firebase.firestore.Timestamp.now().toDate(),
      transaction_type: "return"
    });
    //cambia el estado del libro
    db.collection("books")
      .doc(bookId)
      .update({
        is_book_available: true
      });
    //cambia el número de libros emitidos al alumno
    db.collection("User")
      .doc(UserId)
      .update({
        number_of_books_issued: firebase.firestore.FieldValue.increment(-1)
      });

    // actualiza el estado local
    this.setState({
      bookId: "",
      UserId: ""
    });
  };

  render() {
    const { bookId, UserId, domState, scanned } = this.state;
    if (domState !== "normal") {
      return (
        <BarCodeScanner
          onBarCodeScanned={scanned ? undefined : this.handleBarCodeScanned}
          style={StyleSheet.absoluteFillObject}
        />
      );
    }
    return (
      <KeyboardAvoidingView behavior="padding" style={styles.container}>
        <ImageBackground source={bgImage} style={styles.bgImage}>
          <View style={styles.upperContainer}>
            <Image source={appIcon} style={styles.appIcon} />
            <Image source={appName} style={styles.appName} />
          </View>
          <View style={styles.lowerContainer}>
            <View style={styles.textinputContainer}>
              <TextInput
                style={styles.textinput}
                placeholder={"Id del libro"}
                placeholderTextColor={"#FFFFFF"}
                value={bookId}
                onChangeText={text => this.setState({ bookId: text })}
              />
              <TouchableOpacity
                style={styles.scanbutton}
                onPress={() => this.getCameraPermissions("bookId")}
              >
                <Text style={styles.scanbuttonText}>Escanear</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.textinputContainer, { marginTop: 25 }]}>
              <TextInput
                style={styles.textinput}
                placeholder={"Id del alumno"}
                placeholderTextColor={"#FFFFFF"}
                value={UserId}
                onChangeText={text => this.setState({ UserId: text })}
              />
              <TouchableOpacity
                style={styles.scanbutton}
                onPress={() => this.getCameraPermissions("UserId")}
              >
                <Text style={styles.scanbuttonText}>Escanear</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.button, { marginTop: 25 }]}
              onPress={this.handleTransaction}
            >
              <Text style={styles.buttonText}>Enviar</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>
      </KeyboardAvoidingView>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF"
  },
  bgImage: {
    flex: 1,
    resizeMode: "cover",
    justifyContent: "center"
  },
  upperContainer: {
    flex: 0.5,
    justifyContent: "center",
    alignItems: "center"
  },
  appIcon: {
    width: 200,
    height: 200,
    resizeMode: "contain",
    marginTop: 80
  },
  appName: {
    width: 80,
    height: 80,
    resizeMode: "contain"
  },
  lowerContainer: {
    flex: 0.5,
    alignItems: "center"
  },
  textinputContainer: {
    borderWidth: 2,
    borderRadius: 10,
    flexDirection: "row",
    backgroundColor: "#9DFD24",
    borderColor: "#FFFFFF"
  },
  textinput: {
    width: "57%",
    height: 50,
    padding: 10,
    borderColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 3,
    fontSize: 18,
    backgroundColor: "#5653D4",
    fontFamily: "Rajdhani_600SemiBold",
    color: "#FFFFFF"
  },
  scanbutton: {
    width: 100,
    height: 50,
    backgroundColor: "#9DFD24",
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    justifyContent: "center",
    alignItems: "center"
  },
  scanbuttonText: {
    fontSize: 24,
    color: "#0A0101",
    fontFamily: "Rajdhani_600SemiBold"
  },
  button: {
    width: "43%",
    height: 55,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F48D20",
    borderRadius: 15
  },
  buttonText: {
    fontSize: 24,
    color: "#FFFFFF",
    fontFamily: "Rajdhani_600SemiBold"
  }
});
