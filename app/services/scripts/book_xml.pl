#!/usr/bin/perl
use strict;
use warnings;
use File::Spec;
use XML::LibXML;

# Directories
my $input_dir   = $ARGV[0];
my $output_file = $ARGV[1];

# DTD and Root Setup
my $dtd_decl = '<!DOCTYPE book PUBLIC "-//NLM//DTD BITS Book Interchange DTD v2.0 20130520//EN" "D:/s4c/wordtoxml/FirstXML/BITS-Book-1.0-DTD/BITS-book1.dtd">';

my $master_xml = <<"XML";
<?xml version="1.0" encoding="UTF-8"?>
$dtd_decl
<book xmlns:mml="http://www.w3.org/1998/Math/MathML"
      xmlns:xi="http://www.w3.org/2001/XInclude"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      dtd-version="1.0"
      xml:lang="en">
   <book-meta>
      <book-id book-id-type="isbn">000-0-00-000000-0</book-id>
      <book-title-group>
         <book-title>Combined Book Title</book-title>
      </book-title-group>
   </book-meta>
   <book-body>
   </book-body>
</book>
XML

# Configured parser to strictly keep original whitespace/indentation
my $parser = XML::LibXML->new(
    keep_blanks => 1,
    expand_entities => 0
);

my $master_doc = $parser->parse_string($master_xml);
my ($book_body) = $master_doc->findnodes('//book-body');

# Read input directory
opendir(my $dh, $input_dir) or die "Cannot open directory $input_dir: $!";
my @xml_files = sort grep { /\.xml$/i && $_ !~ /combined_book\.xml$/i } readdir($dh);
closedir($dh);

my $chapter_count = 1;

foreach my $file (@xml_files) {
    my $file_path = File::Spec->catfile($input_dir, $file);
    print "Processing: $file\n";

    eval {
        my $doc = $parser->parse_file($file_path);
        
        # 1. Extract existing <book-part> elements
        my @book_parts = $doc->findnodes('//book-part');

        if (@book_parts) {
            foreach my $part (@book_parts) {
                clean_and_restructure_part($part);
                # Import node along with all internal whitespace text nodes
                my $imported_node = $master_doc->importNode($part, 1);
                $book_body->appendChild($imported_node);
            }
        } 
        # 2. Fallback: Wrap loose <book-body> content into a <book-part>
        else {
            my ($body_node) = $doc->findnodes('//book-body');
            if ($body_node) {
                my $ch_id = sprintf("ch%02d", $chapter_count);
                my $new_part = $master_doc->createElement('book-part');
                $new_part->setAttribute('book-part-type', 'chapter');
                $new_part->setAttribute('id', $ch_id);

                my $new_body = $master_doc->createElement('body');
                my $new_back = $master_doc->createElement('back');

                foreach my $child ($body_node->childNodes) {
                    if ($child->nodeName eq 'ref-list') {
                        my $imp = $master_doc->importNode($child, 1);
                        $new_back->appendChild($imp);
                    } else {
                        my $imp = $master_doc->importNode($child, 1);
                        $new_body->appendChild($imp);
                    }
                }

                $new_part->appendChild($new_body);
                $new_part->appendChild($new_back) if $new_back->hasChildNodes();
                $book_body->appendChild($new_part);
            }
        }
        $chapter_count++;
    };
    if ($@) {
        warn "Failed to parse $file: $@";
    }
}

# Output to file with formatting turned OFF (0) to preserve original whitespace
$master_doc->toFile($output_file, 0);
print "\nSuccess! Combined XML generated preserving original spacing: $output_file\n";

# Helper subroutine to clean ref-list positions inside book-part
sub clean_and_restructure_part {
    my ($part) = @_;
    
    my ($back) = $part->findnodes('./back');
    unless ($back) {
        $back = $part->addNewChild(undef, 'back');
    }

    my @ref_lists = $part->findnodes('.//ref-list');
    foreach my $ref (@ref_lists) {
        next if $ref->parentNode->nodeName eq 'back';
        
        $ref->unbindNode();
        $back->appendChild($ref);
    }
}