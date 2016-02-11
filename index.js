var cheerio = require('cheerio')
	kuler = require("kuler"),
	args = require("args"),
	async = require("async"),
	argv = process.argv,
	fs = require('fs'),
	path = require('path');

/* ------------- */
/*  CLI OPTIONS  */
/* ------------- */
var options = args.Options.parse([
  {
    name: 'help',
    shortName: 'h',
    help: 'Get Help',
    defaultValue : null,
    type : "bool",
    required : false
  },
  {
    name: 'input',
    shortName: 'i',
    help: 'Input folder or XML file',
    defaultValue : null,
    required : true
  },
  {
    name: 'list',
    shortName: 'l',
    help: 'Input TBX list version 1.4',
    defaultValue : null,
    required : true
  }
]);

// Parse cli options
var parsed = args.parser(argv).parse(options);

/* ----------- */
/*  SPLIT VAL  */
/* ----------- */
if(parsed.attribut){
  var attVal = (parsed.attribut).split("::").length > 1 ? (parsed.attribut).split("::")[1].split(",,") : 0 ,
      attName = (parsed.attribut).split("::").length > 1 ? (parsed.attribut).split("::")[0] : parsed.attribut ;
}

/* ----------- */
/*  CHECK ARGS */
/* ----------- */

if(parsed.help){
  // Affichage aide 
  console.info(options.getHelp());
  return;
}

if(!parsed.input){
  console.info(kuler("Please indicate XML File/Folder , see help" , "red"));
  return;
}

if(!parsed.list){
  console.info(kuler("Please indicate TBX V1.4 list , see help" , "red"));
  return;
}

/* ------------- */
/* PATH 2 STRING */
/* ------------- */
parsed.input = (parsed.input).toString();
parsed.list = (parsed.list).toString();


/* --------------------------------- */
/*  Recursive Check & load Files     */
/* --------------------------------- */
var checkPath = function(path2check, done){
	// Verifie Si c'est dossier | fichiers
	fs.stat(path2check , (err, stats) => {
		if(err) throw kuler(err , "red");
		// Si c'est un fichier
		if(stats.isFile()){
		  done(path2check);
		}
		// Si c'ets un dossier.
		else if(stats.isDirectory()){
			fs.readdir(path2check , (err , list) => {
				if(err) throw kuler(err , "red");
				var filesToExecFolder = list.length;
				if(!filesToExecFolder) return;
				list.forEach((file) => {
					file = path.resolve(path2check, file);
					// Recursivité
					checkPath(file,done);
				});
			});
		}
	});
}

// termObj will contains info of termEntries
var termObj = {};


/* --------------------*/
/*  Load TBX 1.4 LIST  */
/* --------------------*/
fs.readFile(parsed.list, (err, data) => {
	if(err) throw kuler(err , "red");
	console.time("listeTBX");
	//Charge la list TBX 1.4 dans cheerio
	var $ = cheerio.load(data, {
	  normalizeWhitespace: true,
	  xmlMode: true
	});

	// Pour chaque termEntry
	async.each($("termEntry") , (termEntry , next) => {

		var obj = {},
		iTermEntry = $(termEntry),
		term = iTermEntry.find("term").first().text().replace(/\s|_/g, '').toLowerCase();

		obj.termpilot = iTermEntry.find("termNote[type='termPilot']").first().text().replace(/\s|_/g, '').toLowerCase();
		obj.formList = iTermEntry.find("descrip[type='formList']").first().text().replace(/\s|_/g, '').toLowerCase();
		obj.xmlid = iTermEntry.attr("xml:id").split("-")[1];
		obj.term = term;

		termObj[term] = obj;
		// termEntry suivant
		next();

	} , (err) => {
		if(err) throw kuler(err , "red");
		console.timeEnd("listeTBX");
		//Tous termEntry Chargé , on charge corpus
	 	checkPath(parsed.input, convertSpanCorresp);
	}); 
});

/* --------------------*/
/*  Load TBX 1.4 LIST  */
/* --------------------*/
var convertSpanCorresp = function(pathXML){

	// Chargement fichier
	fs.readFile(pathXML , (err , file) => {
		if(err) throw kuler(err , "red");
		// Fichier dans cheerio
		var $ = cheerio.load(file, {
		  normalizeWhitespace: true,
		  xmlMode: true,
		  decodeEntities : false
		});

		var spans = $('spanGrp[type="candidatsTermes"] span')

		// Pour chaque span ...
		async.each( spans , (span , nextSpan) => {
			var iSpan = $(span),
					expressionL = "\"" + iSpan.attr("lemma") + "\"",
					expression = expressionL.replace(/\s|_/g, '').toLowerCase(),
					corresp = iSpan.attr("corresp");

			var matched = {};

			// Pour chaque obj de la list crée
			async.each(termObj , (obj , nextObj) => {
				if(obj.formList.indexOf(expression) > (-1)){
					matched[obj.xmlid] = obj;
				}
				nextObj();
			} , (err) => {
				if(err) throw kuler(err , "red");
				var nbOfMatch = Object.keys(matched).length;
				// Si il n'y a aucun match :
				if( nbOfMatch < 1 ){
					// Si c'est un corresp avec attribut smarties (Obligatoire)
					if(corresp.indexOf("smarties") > (-1)){
						console.info("Pas de correspondance trouvé pour " + pathXML + " corresp : " + corresp)
					}
					// Sinon c'est juste un 2.0
					else{
						iSpan.attr("corresp" , "#TS2.0-entry-" + (corresp).replace("#entry-" , ""));
					}
					return;
				}
				// Si plus d'un match => comparaison avec lemme
				else if( nbOfMatch > 1){
					var target = iSpan.attr("target").split(" "),
							lemma = "";
					//Recreation du lemme a partir des targets
					for(var i = 0 ; i < target.length ; i++){
						lemma = lemma + $('spanGrp[type="wordForms"] span[target="' + target[i] + '"]').attr("lemma").replace(/\s|_/g, '').toLowerCase();
					}

					console.info("==========================");
					console.info("Verif du lemme pour : " + pathXML + " corresp : " + corresp + " (Expression : " + expressionL + " / Lemma : " + lemma + ") ");
					console.info("Possibilité : ", matched);

					// Pour chaque match:  garde suivant le lemme
					for(var index in matched){
						if(matched[index].term == lemma){
							console.info("Choix : "  +  matched[index].xmlid);
							matched = matched[index];
							break;
						}
					}
					console.info("==========================");
				}
				// Si un seul match
				else{
					matched = matched[Object.keys(matched)[0]];
				}
				var ts1 = "#TS1.4-entry-" + (matched.xmlid).replace("#entry-" , ""),
						ts2 = (corresp.indexOf("smarties") > (-1)) ? null : "#TS2.0-entry-" + (corresp).replace(/#entry-|#smarties-/ , ""),
						ts  = ts2 ? ts2 + "-" + ts1 : ts1;
				
				iSpan.attr("corresp" , ts );
			});
			
			nextSpan();

		} , (err) => {
			if(err) throw kuler(err , "red");
			// Tous els spans traités , ecriture dans le fichier
			fs.writeFile(pathXML , $.xml() , (err) => {
				if(err) throw kuler(err , "red");
			});
		});  
	
	});

};